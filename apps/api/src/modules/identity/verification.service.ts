import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { IdentityKind } from '@capaport/contracts/auth';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';
import { maskIdentity } from './identity.policy.js';
import type { ChallengeConsumption, ChallengePurpose } from './identity.repository.js';

export type PreparedChallenge = {
  id: string;
  purpose: ChallengePurpose;
  kind: IdentityKind;
  target: string;
  userId: string;
  identityId?: string;
  code: string;
  codeDigest: string;
  expiresAt: Date;
};

export interface VerificationStore {
  createChallenge(input: {
    id: string;
    purpose: ChallengePurpose;
    kind: IdentityKind;
    target: string;
    codeDigest: string;
    userId: string;
    identityId?: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeChallenge(id: string, purpose: ChallengePurpose, codeDigest: string, now: Date): Promise<ChallengeConsumption>;
  markIdentityVerified(userId: string, identityId: string, verifiedAt: Date): Promise<void>;
}

export interface VerificationSender {
  send(input: PreparedChallenge): Promise<void>;
}

type VerificationConfig = Pick<AppConfig['auth'], 'verificationPepper' | 'verificationTtlMinutes'>;

@Injectable()
export class VerificationService {
  private readonly config: VerificationConfig;

  constructor(
    @Inject('VERIFICATION_STORE') private readonly store: VerificationStore,
    @Inject('VERIFICATION_SENDER') private readonly sender: VerificationSender,
    @Inject(APP_CONFIG) config: VerificationConfig | AppConfig,
  ) {
    this.config = 'auth' in config ? config.auth : config;
  }

  prepare(
    purpose: ChallengePurpose,
    kind: IdentityKind,
    target: string,
    userId: string,
    identityId?: string,
  ): PreparedChallenge {
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    return {
      id,
      purpose,
      kind,
      target,
      userId,
      ...(identityId ? { identityId } : {}),
      code,
      codeDigest: this.digest(id, code),
      expiresAt: new Date(Date.now() + this.config.verificationTtlMinutes * 60_000),
    };
  }

  async create(
    purpose: ChallengePurpose,
    kind: IdentityKind,
    target: string,
    userId: string,
    identityId?: string,
  ): Promise<{ challengeId: string; maskedTarget: string; expiresIn: number }> {
    const challenge = this.prepare(purpose, kind, target, userId, identityId);
    await this.store.createChallenge(challenge);
    await this.deliver(challenge);
    return this.publicMetadata(challenge);
  }

  async deliver(challenge: PreparedChallenge): Promise<void> {
    await this.sender.send(challenge);
  }

  async verifyIdentity(challengeId: string, code: string): Promise<{ verified: true }> {
    const result = await this.consume(challengeId, code, 'verify_identity');
    if (!result.identityId)
      throw new AppError('AUTH_VERIFICATION_INVALID', 'The verification request is invalid.', 400);
    await this.store.markIdentityVerified(result.userId, result.identityId, new Date());
    return { verified: true };
  }

  consumeRecovery(challengeId: string, code: string): Promise<Extract<ChallengeConsumption, { status: 'consumed' }>> {
    return this.consume(challengeId, code, 'recover_password');
  }

  publicMetadata(challenge: PreparedChallenge): { challengeId: string; maskedTarget: string; expiresIn: number } {
    return {
      challengeId: challenge.id,
      maskedTarget: maskIdentity(challenge.kind, challenge.target),
      expiresIn: this.config.verificationTtlMinutes * 60,
    };
  }

  private async consume(
    challengeId: string,
    code: string,
    purpose: ChallengePurpose,
  ): Promise<Extract<ChallengeConsumption, { status: 'consumed' }>> {
    const result = await this.store.consumeChallenge(challengeId, purpose, this.digest(challengeId, code), new Date());
    if (result.status === 'consumed') return result;
    const errors: Record<Exclude<ChallengeConsumption['status'], 'consumed'>, [string, string, number]> = {
      not_found: ['AUTH_VERIFICATION_INVALID', 'The verification request is invalid.', 400],
      invalid: ['AUTH_VERIFICATION_INVALID', 'The verification code is incorrect.', 400],
      expired: ['AUTH_VERIFICATION_EXPIRED', 'The verification code has expired.', 410],
      exhausted: ['AUTH_VERIFICATION_EXHAUSTED', 'Too many verification attempts. Request a new code.', 429],
      already_used: ['AUTH_VERIFICATION_USED', 'The verification code has already been used.', 409],
    };
    const [errorCode, message, status] = errors[result.status];
    throw new AppError(errorCode, message, status);
  }

  private digest(challengeId: string, code: string): string {
    return createHmac('sha256', this.config.verificationPepper).update(`${challengeId}:${code}`).digest('hex');
  }
}
