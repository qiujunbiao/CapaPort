import { randomUUID } from 'node:crypto';
import type {
  IdentityKind,
  LoginRequest,
  PublicUser,
  RecoveryCompleteRequest,
  RecoveryStartRequest,
  RegisterRequest,
  TokenPair,
} from '@capaport/contracts/auth';
import { Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { AppError } from '../../platform/errors/app-error.js';
import { maskIdentity, normalizeIdentity, validatePasswordStrength } from './identity.policy.js';
import type { IdentityRecord } from './identity.repository.js';
import type { SessionClient } from './session.service.js';
import type { ChallengeMetadata, PreparedChallenge } from './verification.service.js';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$uAjvCOyjPvCVkOYGkPZHXA$WJ59KOjIYs9bkuEbBL0aXOoZzpfhf5p8IgNRMdQAZ3k';

export interface IdentityDataStore {
  findIdentity(kind: IdentityKind, normalizedValue: string): Promise<IdentityRecord | undefined>;
  findUserById?(userId: string): Promise<IdentityRecord | undefined>;
  createRegistration(input: {
    userId: string;
    identityId: string;
    kind: IdentityKind;
    normalizedValue: string;
    displayName: string;
    passwordHash: string;
    challengeId: string;
    codeDigest: string;
    expiresAt: Date;
  }): Promise<void>;
  changePasswordAndRevoke(userId: string, passwordHash: string, now: Date): Promise<void>;
  listIdentities(userId: string): Promise<Array<{ kind: IdentityKind; value: string; verifiedAt: Date | null }>>;
  exportAccount(userId: string): Promise<Record<string, unknown>>;
  requestAccountDeletion(userId: string, scheduledAt: Date): Promise<void>;
  cancelAccountDeletion(userId: string): Promise<void>;
  accountDeletionStatus(userId: string): Promise<{ status: string; scheduledAt: Date } | undefined>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface RateLimiter {
  assertAllowed(identity: string, ipAddress?: string): Promise<void>;
  recordFailure(identity: string, ipAddress?: string): Promise<void>;
  clear(identity: string, ipAddress?: string): Promise<void>;
}

export interface IdentityVerification {
  prepare(
    purpose: 'verify_identity' | 'recover_password',
    kind: IdentityKind,
    target: string,
    userId: string,
    identityId?: string,
  ): PreparedChallenge;
  deliver(challenge: PreparedChallenge): Promise<void>;
  publicMetadata(challenge: PreparedChallenge): ChallengeMetadata;
  verifyIdentity(challengeId: string, code: string): Promise<{ verified: true }>;
  create(
    purpose: 'verify_identity' | 'recover_password',
    kind: IdentityKind,
    target: string,
    userId: string,
    identityId?: string,
  ): Promise<ChallengeMetadata>;
  consumeRecovery(challengeId: string, code: string): Promise<{ status: 'consumed'; userId: string }>;
}

export interface SessionIssuer {
  issue(userId: string, client: SessionClient): Promise<TokenPair>;
}

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argonHash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(passwordHash, password);
    } catch {
      return false;
    }
  }
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject('IDENTITY_DATA_STORE') private readonly repository: IdentityDataStore,
    @Inject('PASSWORD_HASHER') private readonly password: PasswordHasher,
    @Inject('IDENTITY_VERIFICATION') private readonly verification: IdentityVerification,
    @Inject('SESSION_ISSUER') private readonly sessions: SessionIssuer,
    @Inject('LOGIN_RATE_LIMITER') private readonly rateLimiter: RateLimiter,
  ) {}

  async register(input: RegisterRequest): Promise<ChallengeMetadata> {
    const normalizedValue = normalizeIdentity(input.kind, input.target);
    validatePasswordStrength(input.password);
    if (await this.repository.findIdentity(input.kind, normalizedValue)) {
      throw new AppError('AUTH_IDENTITY_EXISTS', 'An account already uses this email or phone number.', 409);
    }
    const userId = randomUUID();
    const identityId = randomUUID();
    const passwordHash = await this.password.hash(input.password);
    const challenge = this.verification.prepare('verify_identity', input.kind, normalizedValue, userId, identityId);
    try {
      await this.repository.createRegistration({
        userId,
        identityId,
        kind: input.kind,
        normalizedValue,
        displayName: input.displayName.trim(),
        passwordHash,
        challengeId: challenge.id,
        codeDigest: challenge.codeDigest,
        expiresAt: challenge.expiresAt,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new AppError('AUTH_IDENTITY_EXISTS', 'An account already uses this email or phone number.', 409);
      }
      throw error;
    }
    await this.verification.deliver(challenge);
    return this.verification.publicMetadata(challenge);
  }

  verify(challengeId: string, code: string): Promise<{ verified: true }> {
    return this.verification.verifyIdentity(challengeId, code);
  }

  async login(input: LoginRequest, client: Omit<SessionClient, 'deviceName'>): Promise<TokenPair> {
    const normalizedValue = normalizeIdentity(input.kind, input.target);
    await this.rateLimiter.assertAllowed(normalizedValue, client.ipAddress);
    const identity = await this.repository.findIdentity(input.kind, normalizedValue);
    const validPassword = await this.password.verify(identity?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);
    if (!identity || !validPassword) {
      await this.rateLimiter.recordFailure(normalizedValue, client.ipAddress);
      throw new AppError('AUTH_CREDENTIALS_INVALID', 'Email, phone number, or password is incorrect.', 401);
    }
    if (!identity.verifiedAt || identity.status !== 'active') {
      throw new AppError('AUTH_IDENTITY_UNVERIFIED', 'Verify your email or phone number before signing in.', 403);
    }
    await this.rateLimiter.clear(normalizedValue, client.ipAddress);
    return this.sessions.issue(identity.userId, { ...client, deviceName: input.deviceName });
  }

  async startRecovery(
    input: RecoveryStartRequest,
  ): Promise<{ accepted: true; challengeId: string; maskedTarget: string; developmentCode?: string }> {
    const normalizedValue = normalizeIdentity(input.kind, input.target);
    const identity = await this.repository.findIdentity(input.kind, normalizedValue);
    if (!identity?.verifiedAt) {
      return { accepted: true, challengeId: randomUUID(), maskedTarget: maskIdentity(input.kind, normalizedValue) };
    }
    const challenge = await this.verification.create(
      'recover_password',
      input.kind,
      normalizedValue,
      identity.userId,
      identity.identityId,
    );
    return {
      accepted: true,
      challengeId: challenge.challengeId,
      maskedTarget: challenge.maskedTarget,
      ...(challenge.developmentCode ? { developmentCode: challenge.developmentCode } : {}),
    };
  }

  async completeRecovery(input: RecoveryCompleteRequest): Promise<{ recovered: true }> {
    validatePasswordStrength(input.newPassword);
    const challenge = await this.verification.consumeRecovery(input.challengeId, input.code);
    const passwordHash = await this.password.hash(input.newPassword);
    await this.repository.changePasswordAndRevoke(challenge.userId, passwordHash, new Date());
    return { recovered: true };
  }

  async publicUser(identity: IdentityRecord): Promise<PublicUser> {
    const identities = await this.repository.listIdentities(identity.userId);
    return {
      id: identity.userId,
      displayName: identity.displayName,
      identities: identities.map((item) => ({
        kind: item.kind,
        masked: maskIdentity(item.kind, item.value),
        verified: Boolean(item.verifiedAt),
      })),
    };
  }

  async me(userId: string): Promise<PublicUser> {
    const identity = await this.repository.findUserById?.(userId);
    if (!identity) throw new AppError('AUTH_USER_NOT_FOUND', 'The account no longer exists.', 404);
    return this.publicUser(identity);
  }

  exportAccount(userId: string): Promise<Record<string, unknown>> {
    return this.repository.exportAccount(userId);
  }

  async requestDeletion(userId: string): Promise<{ deletionScheduledAt: string }> {
    const existing = await this.repository.accountDeletionStatus(userId);
    if (existing?.status === 'scheduled') return { deletionScheduledAt: existing.scheduledAt.toISOString() };
    const scheduledAt = new Date(Date.now() + 30 * 86_400_000);
    await this.repository.requestAccountDeletion(userId, scheduledAt);
    return { deletionScheduledAt: scheduledAt.toISOString() };
  }

  async cancelDeletion(userId: string): Promise<{ cancelled: true }> {
    await this.repository.cancelAccountDeletion(userId);
    return { cancelled: true };
  }

  async deletionStatus(userId: string): Promise<{ status: string; deletionScheduledAt?: string }> {
    const request = await this.repository.accountDeletionStatus(userId);
    return request
      ? { status: request.status, deletionScheduledAt: request.scheduledAt.toISOString() }
      : { status: 'none' };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
