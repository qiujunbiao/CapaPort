import { z } from 'zod';

export const identityKindSchema = z.enum(['email', 'phone']);
export type IdentityKind = z.infer<typeof identityKindSchema>;

export const registerRequestSchema = z.object({
  kind: identityKindSchema,
  target: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
  displayName: z.string().trim().min(1).max(80),
});

export const verificationRequestSchema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const loginRequestSchema = z.object({
  kind: identityKindSchema,
  target: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(120),
});

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(40).max(1024) });

export const recoveryStartRequestSchema = z.object({
  kind: identityKindSchema,
  target: z.string().trim().min(3).max(320),
});

export const recoveryCompleteRequestSchema = verificationRequestSchema.extend({
  newPassword: z.string().min(1).max(256),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type RecoveryStartRequest = z.infer<typeof recoveryStartRequestSchema>;
export type RecoveryCompleteRequest = z.infer<typeof recoveryCompleteRequestSchema>;

export type AuthenticatedUser = { userId: string; sessionId: string; recentlyAuthenticatedAt?: number };
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
export type PublicUser = {
  id: string;
  displayName: string;
  identities: Array<{ kind: IdentityKind; masked: string; verified: boolean }>;
};
