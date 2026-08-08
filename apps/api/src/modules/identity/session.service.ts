import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedUser, TokenPair } from '@capaport/contracts/auth';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';

export type SessionClient = { deviceName: string; ipAddress?: string; userAgent?: string };
export type StoredSessionClient = { deviceName: string; ipHash?: string; userAgent?: string };
export type SessionSummary = {
  id: string;
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
  revokedAt?: Date;
};

export type RefreshRotation =
  | { status: 'rotated'; userId: string; sessionId: string }
  | { status: 'replay' }
  | { status: 'invalid' };

export interface SessionStore {
  create(input: {
    id: string;
    familyId: string;
    userId: string;
    refreshDigest: string;
    expiresAt: Date;
    client: StoredSessionClient;
  }): Promise<void>;
  rotate(input: { currentDigest: string; nextDigest: string; expiresAt: Date; now: Date }): Promise<RefreshRotation>;
  revoke(userId: string, sessionId: string, reason: string): Promise<void>;
  revokeFamily(currentDigest: string, reason: string): Promise<void>;
  assertActive(userId: string, sessionId: string): Promise<boolean>;
  list(userId: string, currentSessionId: string): Promise<SessionSummary[]>;
}

type SessionConfig = Pick<AppConfig['auth'], 'jwtSecret' | 'refreshPepper' | 'accessTtlSeconds' | 'refreshTtlDays'>;

@Injectable()
export class SessionService {
  private readonly jwtKey: Uint8Array;
  private readonly config: SessionConfig;

  constructor(
    @Inject('SESSION_STORE') private readonly store: SessionStore,
    @Inject(APP_CONFIG) config: SessionConfig | AppConfig,
  ) {
    this.config = 'auth' in config ? config.auth : config;
    this.jwtKey = new TextEncoder().encode(this.config.jwtSecret);
  }

  async issue(userId: string, client: SessionClient): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = this.generateRefreshToken();
    await this.store.create({
      id: sessionId,
      familyId: randomUUID(),
      userId,
      refreshDigest: this.digestRefreshToken(refreshToken),
      expiresAt: this.refreshExpiry(),
      client: {
        deviceName: client.deviceName,
        ...(client.ipAddress ? { ipHash: this.digestClientIp(client.ipAddress) } : {}),
        ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 512) } : {}),
      },
    });
    return this.tokenPair(userId, sessionId, refreshToken, Math.floor(Date.now() / 1000));
  }

  async refresh(currentToken: string): Promise<TokenPair> {
    const nextToken = this.generateRefreshToken();
    const currentDigest = this.digestRefreshToken(currentToken);
    const result = await this.store.rotate({
      currentDigest,
      nextDigest: this.digestRefreshToken(nextToken),
      expiresAt: this.refreshExpiry(),
      now: new Date(),
    });
    if (result.status === 'replay') {
      await this.store.revokeFamily(currentDigest, 'refresh_token_replay');
      throw new AppError('AUTH_REFRESH_REPLAY', 'This refresh token has already been used. Sign in again.', 401);
    }
    if (result.status === 'invalid') {
      throw new AppError('AUTH_REFRESH_INVALID', 'The refresh token is invalid or expired.', 401);
    }
    return this.tokenPair(result.userId, result.sessionId, nextToken);
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    try {
      const result = await jwtVerify(accessToken, this.jwtKey, { issuer: 'capaport', audience: 'capaport-client' });
      const userId = result.payload.sub;
      const sessionId = result.payload.sid;
      const recentlyAuthenticatedAt = result.payload.auth_time;
      if (typeof userId !== 'string' || typeof sessionId !== 'string') throw new Error('missing claims');
      if (!(await this.store.assertActive(userId, sessionId))) throw new Error('revoked session');
      return {
        userId,
        sessionId,
        recentlyAuthenticatedAt: typeof recentlyAuthenticatedAt === 'number' ? recentlyAuthenticatedAt : 0,
      };
    } catch {
      throw new AppError('AUTH_ACCESS_INVALID', 'The access token is invalid or expired.', 401);
    }
  }

  revoke(userId: string, sessionId: string, reason = 'user_logout'): Promise<void> {
    return this.store.revoke(userId, sessionId, reason);
  }

  list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    return this.store.list(userId, currentSessionId);
  }

  private async tokenPair(
    userId: string,
    sessionId: string,
    refreshToken: string,
    recentlyAuthenticatedAt?: number,
  ): Promise<TokenPair> {
    const accessToken = await new SignJWT({
      sid: sessionId,
      ...(recentlyAuthenticatedAt === undefined ? {} : { auth_time: recentlyAuthenticatedAt }),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer('capaport')
      .setAudience('capaport-client')
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.jwtKey);
    return { accessToken, refreshToken, expiresIn: this.config.accessTtlSeconds };
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private digestRefreshToken(token: string): string {
    return createHmac('sha256', this.config.refreshPepper).update(token).digest('hex');
  }

  private digestClientIp(ipAddress: string): string {
    return createHmac('sha256', this.config.refreshPepper).update(`ip:${ipAddress}`).digest('hex');
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTtlDays * 86_400_000);
  }
}
