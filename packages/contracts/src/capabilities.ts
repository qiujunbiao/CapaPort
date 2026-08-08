import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const tagSchema = slugSchema.max(40);
export const agentIdSchema = z.enum(['codex', 'claude-code', 'cursor', 'gemini-cli']);

export const createCapabilityRequestSchema = z.object({
  spaceId: z.uuid(),
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(''),
  tags: z.array(tagSchema).max(20).default([]),
  compatibility: z.array(agentIdSchema).min(1).max(4),
  forkedFromVersionId: z.uuid().optional(),
});
export const updateCapabilityRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).optional(),
    tags: z.array(tagSchema).max(20).optional(),
    compatibility: z.array(agentIdSchema).min(1).max(4).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const requestArtifactUploadSchema = z.object({
  spaceId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.literal('application/zip'),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const createDraftRevisionRequestSchema = z.object({ artifactId: z.uuid() });
export const capabilitySearchQuerySchema = z.object({
  query: z.string().trim().max(120).default(''),
  tag: tagSchema.optional(),
  agent: agentIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type AgentId = z.infer<typeof agentIdSchema>;
export type CreateCapabilityRequest = z.infer<typeof createCapabilityRequestSchema>;
export type UpdateCapabilityRequest = z.infer<typeof updateCapabilityRequestSchema>;
export type RequestArtifactUpload = z.infer<typeof requestArtifactUploadSchema>;
export type CapabilitySearchQuery = z.infer<typeof capabilitySearchQuerySchema>;

export type CapabilitySummary = {
  id: string;
  organizationId: string;
  spaceId: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  compatibility: AgentId[];
  ownerUserId: string;
  status: 'active' | 'archived';
  hasPublishedVersion?: boolean;
};

export type ArtifactUploadPlan = {
  uploadId: string;
  method: 'PUT';
  url: string;
  headers: {
    'content-type': 'application/zip';
    'x-amz-server-side-encryption'?: 'AES256' | 'aws:kms';
    'x-amz-server-side-encryption-aws-kms-key-id'?: string;
  };
  expiresIn: number;
};
