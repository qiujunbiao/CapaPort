import { z } from 'zod';

export const organizationRoleSchema = z.enum(['owner', 'admin', 'auditor', 'member']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
    .optional(),
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
export const closeOrganizationRequestSchema = z.object({ confirmation: z.string().trim().min(2).max(120) });

export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type ChangeOrganizationRoleRequest = z.infer<typeof changeOrganizationRoleRequestSchema>;
export type CloseOrganizationRequest = z.infer<typeof closeOrganizationRequestSchema>;

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  status: 'active' | 'closing' | 'archived';
  deletionScheduledAt?: string;
};
export type TenantContext = { organizationId: string; membershipId: string; organizationRole: OrganizationRole };

export const scanSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const executablePolicySchema = z.enum(['deny', 'confirm', 'allow-listed']);
export const organizationSecurityPolicySchema = z.object({
  blockedSeverities: z.array(scanSeveritySchema).min(1).max(4),
  confirmationSeverities: z.array(scanSeveritySchema).max(4),
  blockedTerms: z.array(z.string().trim().min(1).max(200)).max(200),
  allowedExecutablePaths: z.array(z.string().trim().min(1).max(500)).max(200),
  allowedNetworkHosts: z.array(z.string().trim().min(1).max(253)).max(200),
  executablePolicy: executablePolicySchema,
});
export type OrganizationSecurityPolicy = z.infer<typeof organizationSecurityPolicySchema>;
