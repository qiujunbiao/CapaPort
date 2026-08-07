import { z } from 'zod';

export const organizationRoleSchema = z.enum(['owner', 'admin', 'auditor', 'member']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
});
export const updateOrganizationRequestSchema = z.object({ name: z.string().trim().min(2).max(120) });
export const inviteMemberRequestSchema = z.object({
  kind: z.enum(['email', 'phone']),
  target: z.string().trim().min(3).max(320),
  role: z.enum(['admin', 'auditor', 'member']).default('member'),
});
export const acceptInvitationRequestSchema = z.object({ token: z.string().min(32).max(1024) });
export const changeOrganizationRoleRequestSchema = z.object({ role: z.enum(['admin', 'auditor', 'member']) });
export const transferOwnershipRequestSchema = z.object({ membershipId: z.uuid() });

export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type ChangeOrganizationRoleRequest = z.infer<typeof changeOrganizationRoleRequestSchema>;

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  status: 'active' | 'archived';
};
export type TenantContext = { organizationId: string; membershipId: string; organizationRole: OrganizationRole };
