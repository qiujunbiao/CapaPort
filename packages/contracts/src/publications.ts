import { z } from 'zod';

const semanticVersionSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
const riskAcceptanceSchema = z.object({
  findingDigests: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .max(100),
  reason: z.string().trim().min(3).max(2_000),
});

export const submitPublicationRequestSchema = z.object({
  draftId: z.uuid(),
  targetSpaceId: z.uuid(),
  version: semanticVersionSchema,
  riskAcceptance: riskAcceptanceSchema.optional(),
});
export const reviewPublicationRequestSchema = z.object({ reason: z.string().trim().min(3).max(2_000) });
export const publicationListQuerySchema = z.object({
  status: z.enum(['in_review', 'published', 'changes_requested', 'rejected', 'withdrawn']).optional(),
  targetSpaceId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const versionDiffQuerySchema = z.object({ against: z.uuid() });
export const promotePublicationRequestSchema = z.object({
  sourceVersionId: z.uuid(),
  targetSpaceId: z.uuid(),
  version: semanticVersionSchema,
  riskAcceptance: riskAcceptanceSchema.optional(),
});

export type PublicationStatus = 'in_review' | 'published' | 'changes_requested' | 'rejected' | 'withdrawn';
export type VersionStatus = 'published' | 'deprecated' | 'withdrawn' | 'archived';
export type SubmitPublicationRequest = z.infer<typeof submitPublicationRequestSchema>;
export type PromotePublicationRequest = z.infer<typeof promotePublicationRequestSchema>;
export type PublicationListQuery = z.infer<typeof publicationListQuerySchema>;

export type PublicationSummary = {
  id: string;
  organizationId: string;
  capabilityId: string;
  sourceSpaceId: string;
  sourceRevisionId?: string;
  sourceVersionId?: string;
  targetSpaceId: string;
  candidateDigest: string;
  version: string;
  status: PublicationStatus;
  submittedByUserId: string;
  publishedVersionId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type PublicationReviewSummary = {
  id: string;
  publicationId: string;
  reviewerUserId: string;
  decision: 'approve' | 'request_changes' | 'reject';
  reason: string;
  candidateDigest: string;
  createdAt: string;
};

export type CapabilityVersionSummary = {
  id: string;
  organizationId: string;
  capabilityId: string;
  spaceId: string;
  version: string;
  contentDigest: string;
  status: VersionStatus;
  publishedAt: string;
};

export type CapabilityVersionDiff = {
  fromVersionId: string;
  toVersionId: string;
  added: string[];
  modified: string[];
  removed: string[];
  recommendedChange: 'major' | 'minor' | 'patch';
};

export type PublicationCandidateDiff = {
  fromVersionId: string | null;
  candidateDigest: string;
  added: string[];
  modified: string[];
  removed: string[];
  recommendedChange: 'major' | 'minor' | 'patch';
};
