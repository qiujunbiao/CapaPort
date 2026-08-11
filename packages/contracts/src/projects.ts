import { z } from 'zod';
import { agentIdSchema, type AgentId } from './capabilities.js';

export const projectBindingIdSchema = z.uuid();

export const createProjectBindingRequestSchema = z
  .object({
    deviceId: z.uuid(),
    localBindingId: projectBindingIdSchema,
    agents: z
      .array(agentIdSchema)
      .min(1)
      .max(6)
      .transform((values) => [...new Set(values)]),
  })
  .strict();

export const registerProjectContextRequestSchema = z
  .object({
    bindingId: z.uuid(),
    artifactId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    selectionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    fileCount: z.number().int().min(1).max(1_000),
    totalBytes: z.number().int().min(1).max(4_000_000),
    agents: z
      .array(agentIdSchema)
      .min(1)
      .max(6)
      .transform((values) => [...new Set(values)]),
    scan: z
      .object({
        status: z.literal('passed'),
        engineVersion: z.string().trim().min(1).max(40),
        scannedAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

export type CreateProjectBindingRequest = z.infer<typeof createProjectBindingRequestSchema>;
export type RegisterProjectContextRequest = z.infer<typeof registerProjectContextRequestSchema>;

export type ProjectBindingSummary = {
  id: string;
  organizationId: string;
  projectSpaceId: string;
  deviceId: string;
  localBindingId: string;
  agents: AgentId[];
  status: 'active' | 'removed';
  lastSyncedAt?: string;
  createdAt: string;
};

export type ProjectContextSummary = {
  id: string;
  organizationId: string;
  projectSpaceId: string;
  bindingId: string;
  deviceId: string;
  artifactId: string;
  digest: string;
  selectionDigest: string;
  fileCount: number;
  totalBytes: number;
  agents: AgentId[];
  scanEngineVersion: string;
  createdAt: string;
};

export type ProjectContextDownload = {
  contextId: string;
  digest: string;
  url: string;
  expiresIn: number;
};
