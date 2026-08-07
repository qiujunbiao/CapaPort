import { z } from 'zod';

export const spaceTypeSchema = z.enum(['personal', 'team', 'project', 'organization']);
export const spaceRoleSchema = z.enum(['manager', 'reviewer', 'contributor', 'viewer']);
export const spaceReviewPolicySchema = z.enum(['direct', 'required']);

export const createSpaceRequestSchema = z.object({
  type: z.enum(['team', 'project']),
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  reviewPolicy: spaceReviewPolicySchema.default('required'),
});
export const updateSpaceRequestSchema = z.object({ name: z.string().trim().min(2).max(120) });
export const updateSpaceReviewPolicyRequestSchema = z.object({ reviewPolicy: spaceReviewPolicySchema });
export const addSpaceMemberRequestSchema = z.object({
  userId: z.uuid(),
  role: spaceRoleSchema,
});
export const changeSpaceMemberRoleRequestSchema = z.object({ role: spaceRoleSchema });

export type SpaceType = z.infer<typeof spaceTypeSchema>;
export type SpaceRole = z.infer<typeof spaceRoleSchema>;
export type SpaceReviewPolicy = z.infer<typeof spaceReviewPolicySchema>;
export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;
export type UpdateSpaceRequest = z.infer<typeof updateSpaceRequestSchema>;

export type SpaceSummary = {
  id: string;
  organizationId: string;
  type: SpaceType;
  name: string;
  slug: string;
  reviewPolicy: SpaceReviewPolicy;
  status: 'active' | 'archived';
  ownerUserId?: string;
  role?: SpaceRole;
};
