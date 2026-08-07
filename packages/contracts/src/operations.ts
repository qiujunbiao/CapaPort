import { z } from 'zod';
import { agentIdSchema } from './capabilities.js';

export const auditQuerySchema = z.object({
  action: z.string().trim().min(1).max(120).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const notificationQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const productEventSchema = z
  .object({
    eventName: z.enum([
      'agent.discovered',
      'capability.imported',
      'publication.started',
      'capability.installed',
      'capability.updated',
      'capability.uninstalled',
    ]),
    capabilityId: z.uuid().optional(),
    agent: agentIdSchema.optional(),
    outcome: z.enum(['success', 'failure', 'cancelled']).optional(),
    source: z.enum(['desktop', 'web', 'cli']),
    durationBucket: z.enum(['lt_1s', '1s_10s', '10s_60s', 'gt_60s']).optional(),
  })
  .strict();
export const metricsQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type ProductEvent = z.infer<typeof productEventSchema>;
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export type AuditEntry = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actorUserId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type NotificationSummary = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
};
