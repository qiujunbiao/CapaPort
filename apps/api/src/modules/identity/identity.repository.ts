import { randomUUID } from 'node:crypto';
import type { IdentityKind } from '@agentdoor/contracts/auth';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { refreshTokens, sessions, userIdentities, users, verificationChallenges } from '../../db/schema/identity.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { RefreshRotation, SessionStore, SessionSummary, StoredSessionClient } from './session.service.js';

export type IdentityRecord = {
  identityId: string;
  userId: string;
  kind: IdentityKind;
  normalizedValue: string;
  verifiedAt: Date | null;
  displayName: string;
  passwordHash: string;
  status: string;
};

export type ChallengePurpose = 'verify_identity' | 'recover_password';
export type ChallengeConsumption =
  | { status: 'consumed'; userId: string; identityId: string | null; kind: IdentityKind; target: string }
  | { status: 'not_found' | 'expired' | 'invalid' | 'exhausted' | 'already_used' };

@Injectable()
export class IdentityRepository implements SessionStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async findIdentity(kind: IdentityKind, normalizedValue: string): Promise<IdentityRecord | undefined> {
    const [record] = await this.database.db
      .select({
        identityId: userIdentities.id,
        userId: users.id,
        kind: userIdentities.kind,
        normalizedValue: userIdentities.normalizedValue,
        verifiedAt: userIdentities.verifiedAt,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(and(eq(userIdentities.kind, kind), eq(userIdentities.normalizedValue, normalizedValue)))
      .limit(1);
    return record ? ({ ...record, kind: record.kind as IdentityKind } satisfies IdentityRecord) : undefined;
  }

  async findUserById(userId: string): Promise<IdentityRecord | undefined> {
    const [record] = await this.database.db
      .select({
        identityId: userIdentities.id,
        userId: users.id,
        kind: userIdentities.kind,
        normalizedValue: userIdentities.normalizedValue,
        verifiedAt: userIdentities.verifiedAt,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .innerJoin(userIdentities, eq(userIdentities.userId, users.id))
      .where(eq(users.id, userId))
      .orderBy(desc(userIdentities.verifiedAt))
      .limit(1);
    return record ? ({ ...record, kind: record.kind as IdentityKind } satisfies IdentityRecord) : undefined;
  }

  async createRegistration(input: {
    userId: string;
    identityId: string;
    kind: IdentityKind;
    normalizedValue: string;
    displayName: string;
    passwordHash: string;
    challengeId: string;
    codeDigest: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: input.userId,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      });
      await transaction.insert(userIdentities).values({
        id: input.identityId,
        userId: input.userId,
        kind: input.kind,
        normalizedValue: input.normalizedValue,
      });
      await transaction.insert(verificationChallenges).values({
        id: input.challengeId,
        purpose: 'verify_identity',
        kind: input.kind,
        target: input.normalizedValue,
        codeDigest: input.codeDigest,
        userId: input.userId,
        identityId: input.identityId,
        expiresAt: input.expiresAt,
      });
    });
  }

  async createChallenge(input: {
    id: string;
    purpose: ChallengePurpose;
    kind: IdentityKind;
    target: string;
    codeDigest: string;
    userId: string;
    identityId?: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.db.insert(verificationChallenges).values({
      id: input.id,
      purpose: input.purpose,
      kind: input.kind,
      target: input.target,
      codeDigest: input.codeDigest,
      userId: input.userId,
      identityId: input.identityId,
      expiresAt: input.expiresAt,
    });
  }

  async consumeChallenge(
    challengeId: string,
    purpose: ChallengePurpose,
    codeDigest: string,
    now: Date,
  ): Promise<ChallengeConsumption> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        purpose: string;
        code_digest: string;
        user_id: string | null;
        identity_id: string | null;
        kind: IdentityKind;
        target: string;
        expires_at: Date;
        consumed_at: Date | null;
        attempts: number;
      }>('SELECT * FROM verification_challenges WHERE id = $1 FOR UPDATE', [challengeId]);
      const challenge = result.rows[0];
      if (!challenge || challenge.purpose !== purpose || !challenge.user_id) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (challenge.consumed_at) {
        await client.query('ROLLBACK');
        return { status: 'already_used' };
      }
      if (challenge.expires_at <= now) {
        await client.query('ROLLBACK');
        return { status: 'expired' };
      }
      if (challenge.attempts >= 5) {
        await client.query('ROLLBACK');
        return { status: 'exhausted' };
      }
      if (challenge.code_digest !== codeDigest) {
        await client.query('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = $1', [challengeId]);
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      await client.query('UPDATE verification_challenges SET consumed_at = $2 WHERE id = $1', [challengeId, now]);
      await client.query('COMMIT');
      return {
        status: 'consumed',
        userId: challenge.user_id,
        identityId: challenge.identity_id,
        kind: challenge.kind,
        target: challenge.target,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markIdentityVerified(userId: string, identityId: string, verifiedAt: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(userIdentities).set({ verifiedAt }).where(eq(userIdentities.id, identityId));
      await transaction.update(users).set({ status: 'active', updatedAt: verifiedAt }).where(eq(users.id, userId));
    });
  }

  async changePasswordAndRevoke(userId: string, passwordHash: string, now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
      await transaction
        .update(sessions)
        .set({ revokedAt: now, revocationReason: 'password_recovery' })
        .where(eq(sessions.userId, userId));
      const userSessions = await transaction
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, userId));
      for (const session of userSessions) {
        await transaction.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.sessionId, session.id));
      }
    });
  }

  async listIdentities(userId: string): Promise<Array<{ kind: IdentityKind; value: string; verifiedAt: Date | null }>> {
    const rows = await this.database.db
      .select({
        kind: userIdentities.kind,
        value: userIdentities.normalizedValue,
        verifiedAt: userIdentities.verifiedAt,
      })
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));
    return rows.map((row) => ({ ...row, kind: row.kind as IdentityKind }));
  }

  async create(input: {
    id: string;
    familyId: string;
    userId: string;
    refreshDigest: string;
    expiresAt: Date;
    client: StoredSessionClient;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(sessions).values({
        id: input.id,
        familyId: input.familyId,
        userId: input.userId,
        deviceName: input.client.deviceName,
        ipHash: input.client.ipHash,
        userAgent: input.client.userAgent,
        expiresAt: input.expiresAt,
      });
      await transaction.insert(refreshTokens).values({
        id: randomUUID(),
        sessionId: input.id,
        familyId: input.familyId,
        tokenDigest: input.refreshDigest,
        expiresAt: input.expiresAt,
      });
    });
  }

  async rotate(input: {
    currentDigest: string;
    nextDigest: string;
    expiresAt: Date;
    now: Date;
  }): Promise<RefreshRotation> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        session_id: string;
        family_id: string;
        user_id: string;
        token_expires_at: Date;
        used_at: Date | null;
        token_revoked_at: Date | null;
        session_revoked_at: Date | null;
        session_expires_at: Date;
      }>(
        `SELECT rt.session_id, rt.family_id, s.user_id, rt.expires_at AS token_expires_at,
                rt.used_at, rt.revoked_at AS token_revoked_at, s.revoked_at AS session_revoked_at,
                s.expires_at AS session_expires_at
           FROM refresh_tokens rt
           JOIN sessions s ON s.id = rt.session_id
          WHERE rt.token_digest = $1
          FOR UPDATE OF rt, s`,
        [input.currentDigest],
      );
      const token = result.rows[0];
      if (!token) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }
      if (token.used_at || token.token_revoked_at) {
        await this.revokeFamilyWithClient(client, token.family_id, input.now, 'refresh_token_replay');
        await client.query('COMMIT');
        return { status: 'replay' };
      }
      if (token.session_revoked_at || token.token_expires_at <= input.now || token.session_expires_at <= input.now) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }
      await client.query('UPDATE refresh_tokens SET used_at = $2 WHERE token_digest = $1', [
        input.currentDigest,
        input.now,
      ]);
      await client.query(
        `INSERT INTO refresh_tokens (id, session_id, family_id, token_digest, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), token.session_id, token.family_id, input.nextDigest, input.expiresAt],
      );
      await client.query('UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE id = $1', [
        token.session_id,
        input.now,
        input.expiresAt,
      ]);
      await client.query('COMMIT');
      return { status: 'rotated', userId: token.user_id, sessionId: token.session_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(userId: string, sessionId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(sessions)
        .set({ revokedAt: now, revocationReason: reason })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
      await transaction.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.sessionId, sessionId));
    });
  }

  async revokeFamily(currentDigest: string, reason: string): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ family_id: string }>(
        'SELECT family_id FROM refresh_tokens WHERE token_digest = $1 FOR UPDATE',
        [currentDigest],
      );
      if (result.rows[0]) await this.revokeFamilyWithClient(client, result.rows[0].family_id, new Date(), reason);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async assertActive(userId: string, sessionId: string): Promise<boolean> {
    const [session] = await this.database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .limit(1);
    if (!session) return false;
    const result = await this.database.pool.query<{ active: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > now()) AS active',
      [sessionId, userId],
    );
    return result.rows[0]?.active ?? false;
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.database.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      current: row.id === currentSessionId,
      ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    }));
  }

  private async revokeFamilyWithClient(
    client: { query(query: string, values?: unknown[]): Promise<unknown> },
    familyId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await client.query(
      'UPDATE sessions SET revoked_at=$2, revocation_reason=$3 WHERE family_id=$1 AND revoked_at IS NULL',
      [familyId, now, reason],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at=$2 WHERE family_id=$1 AND revoked_at IS NULL', [
      familyId,
      now,
    ]);
  }
}
