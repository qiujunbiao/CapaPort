import { z } from 'zod';
import { agentIdSchema, type AgentId } from './capabilities.js';

export const registerDeviceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    platform: z.enum(['macos', 'windows', 'linux']),
    appVersion: z.string().trim().min(1).max(40),
    supportedAgents: z.array(agentIdSchema).min(1).max(6),
  })
  .strict();
export const updateDeviceRequestSchema = registerDeviceRequestSchema
  .pick({ name: true, appVersion: true, supportedAgents: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
export const createInstallPlanRequestSchema = z.object({
  deviceId: z.uuid(),
  capabilityId: z.uuid(),
  versionId: z.uuid(),
  agent: agentIdSchema,
});
export const reportInstallationRequestSchema = z
  .object({
    deviceId: z.uuid(),
    capabilityId: z.uuid(),
    versionId: z.uuid(),
    agent: agentIdSchema,
    outcome: z.enum(['installed', 'failed', 'uninstalled']),
    failureCode: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((value, context) => {
    if (value.outcome === 'failed' && !value.failureCode) {
      context.addIssue({ code: 'custom', path: ['failureCode'], message: 'Failure code is required.' });
    }
    if (value.outcome !== 'failed' && value.failureCode) {
      context.addIssue({ code: 'custom', path: ['failureCode'], message: 'Failure code is only allowed on failure.' });
    }
  });

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;
export type UpdateDeviceRequest = z.infer<typeof updateDeviceRequestSchema>;
export type CreateInstallPlanRequest = z.infer<typeof createInstallPlanRequestSchema>;
export type ReportInstallationRequest = z.infer<typeof reportInstallationRequestSchema>;

export type DeviceSummary = {
  id: string;
  organizationId: string;
  name: string;
  platform: 'macos' | 'windows' | 'linux';
  appVersion: string;
  supportedAgents: AgentId[];
  status: 'active' | 'revoked';
  lastSeenAt: string;
};

export type InstallPlan = {
  capabilityId: string;
  versionId: string;
  version: string;
  digest: string;
  adapter: AgentId;
  permissions: { filesystem: 'none' | 'read-project' | 'write-project'; network: 'none' | 'restricted' | 'full' };
  download: { url: string; expiresIn: number };
};

export type UpdateCheck =
  | { action: 'none'; currentVersionId: string }
  | { action: 'update'; currentVersionId: string; availableVersionId: string; availableVersion: string }
  | { action: 'remove'; currentVersionId: string; reason: 'withdrawn' | 'archived' };
