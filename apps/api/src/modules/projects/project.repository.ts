import { randomUUID } from 'node:crypto';
import type { ProjectContextSummary } from '@capaport/contracts/projects';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { devices } from '../../db/schema/distribution.js';
import { auditLogs } from '../../db/schema/organizations.js';
import { projectBindings, projectContextSnapshots } from '../../db/schema/projects.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { ProjectBindingRecord, ProjectDataStore } from './project.service.js';

@Injectable()
export class ProjectRepository implements ProjectDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async findOwnedDevice(organizationId: string, userId: string, deviceId: string): Promise<boolean> {
    const [device] = await this.database.db
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(
          eq(devices.organizationId, organizationId),
          eq(devices.userId, userId),
          eq(devices.id, deviceId),
          eq(devices.status, 'active'),
        ),
      )
      .limit(1);
    return Boolean(device);
  }

  async createBinding(input: ProjectBindingRecord): Promise<ProjectBindingRecord> {
    const [row] = await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(projectBindings)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          projectSpaceId: input.projectSpaceId,
          userId: input.userId,
          deviceId: input.deviceId,
          localBindingId: input.localBindingId,
          agents: input.agents,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [
            projectBindings.organizationId,
            projectBindings.projectSpaceId,
            projectBindings.deviceId,
            projectBindings.localBindingId,
          ],
          set: { agents: input.agents, status: 'active', updatedAt: new Date() },
        })
        .returning();
      const current = rows[0];
      if (!current) throw new AppError('PROJECT_BINDING_FAILED', 'Unable to create project binding.', 500);
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: 'project.binding_created',
        resourceType: 'project_binding',
        resourceId: current.id,
        metadata: { projectSpaceId: input.projectSpaceId, deviceId: input.deviceId, agents: input.agents },
      });
      return rows;
    });
    if (!row) throw new AppError('PROJECT_BINDING_FAILED', 'Unable to create project binding.', 500);
    return this.binding(row);
  }

  async listBindings(organizationId: string, projectSpaceId: string, userId: string) {
    const rows = await this.database.db
      .select()
      .from(projectBindings)
      .where(
        and(
          eq(projectBindings.organizationId, organizationId),
          eq(projectBindings.projectSpaceId, projectSpaceId),
          eq(projectBindings.userId, userId),
        ),
      )
      .orderBy(desc(projectBindings.updatedAt));
    return rows.map((row) => this.binding(row));
  }

  async findBinding(organizationId: string, projectSpaceId: string, userId: string, bindingId: string) {
    const [row] = await this.database.db
      .select()
      .from(projectBindings)
      .where(
        and(
          eq(projectBindings.organizationId, organizationId),
          eq(projectBindings.projectSpaceId, projectSpaceId),
          eq(projectBindings.userId, userId),
          eq(projectBindings.id, bindingId),
        ),
      )
      .limit(1);
    return row ? this.binding(row) : undefined;
  }

  async removeBinding(organizationId: string, projectSpaceId: string, userId: string, bindingId: string) {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .update(projectBindings)
        .set({ status: 'removed', updatedAt: new Date() })
        .where(
          and(
            eq(projectBindings.organizationId, organizationId),
            eq(projectBindings.projectSpaceId, projectSpaceId),
            eq(projectBindings.userId, userId),
            eq(projectBindings.id, bindingId),
          ),
        )
        .returning({ id: projectBindings.id });
      if (!row) throw new AppError('PROJECT_NOT_FOUND', 'Project resource was not found.', 404);
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId,
        actorUserId: userId,
        action: 'project.binding_removed',
        resourceType: 'project_binding',
        resourceId: bindingId,
        metadata: { projectSpaceId },
      });
    });
  }

  async createContext(input: ProjectContextSummary & { userId: string; scannedAt: string }) {
    const [row] = await this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(projectContextSnapshots)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          projectSpaceId: input.projectSpaceId,
          bindingId: input.bindingId,
          deviceId: input.deviceId,
          artifactId: input.artifactId,
          digest: input.digest,
          selectionDigest: input.selectionDigest,
          fileCount: input.fileCount,
          totalBytes: input.totalBytes,
          agents: input.agents,
          scanEngineVersion: input.scanEngineVersion,
          scannedAt: new Date(input.scannedAt),
        })
        .onConflictDoNothing()
        .returning();
      const current = rows[0];
      if (current) {
        await transaction
          .update(projectBindings)
          .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(projectBindings.id, input.bindingId));
        await transaction.insert(auditLogs).values({
          id: randomUUID(),
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: 'project.context_synced',
          resourceType: 'project_context',
          resourceId: current.id,
          metadata: {
            projectSpaceId: input.projectSpaceId,
            bindingId: input.bindingId,
            deviceId: input.deviceId,
            digest: input.digest,
            fileCount: input.fileCount,
            totalBytes: input.totalBytes,
            agents: input.agents,
          },
        });
      }
      return rows;
    });
    if (row) return this.context(row);
    const [existing] = await this.database.db
      .select()
      .from(projectContextSnapshots)
      .where(
        and(
          eq(projectContextSnapshots.organizationId, input.organizationId),
          eq(projectContextSnapshots.bindingId, input.bindingId),
          eq(projectContextSnapshots.digest, input.digest),
        ),
      )
      .limit(1);
    if (!existing) throw new AppError('PROJECT_SYNC_FAILED', 'Unable to register project context.', 500);
    return this.context(existing);
  }

  async listContexts(organizationId: string, projectSpaceId: string) {
    const rows = await this.database.db
      .select({ snapshot: projectContextSnapshots })
      .from(projectContextSnapshots)
      .innerJoin(
        projectBindings,
        and(
          eq(projectBindings.id, projectContextSnapshots.bindingId),
          eq(projectBindings.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(projectContextSnapshots.organizationId, organizationId),
          eq(projectContextSnapshots.projectSpaceId, projectSpaceId),
        ),
      )
      .orderBy(desc(projectContextSnapshots.createdAt));
    return rows.map(({ snapshot }) => this.context(snapshot));
  }

  async findContext(organizationId: string, projectSpaceId: string, contextId: string) {
    const [row] = await this.database.db
      .select({ snapshot: projectContextSnapshots })
      .from(projectContextSnapshots)
      .innerJoin(
        projectBindings,
        and(
          eq(projectBindings.id, projectContextSnapshots.bindingId),
          eq(projectBindings.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(projectContextSnapshots.organizationId, organizationId),
          eq(projectContextSnapshots.projectSpaceId, projectSpaceId),
          eq(projectContextSnapshots.id, contextId),
        ),
      )
      .limit(1);
    return row ? this.context(row.snapshot) : undefined;
  }

  private binding(row: typeof projectBindings.$inferSelect): ProjectBindingRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectSpaceId: row.projectSpaceId,
      userId: row.userId,
      deviceId: row.deviceId,
      localBindingId: row.localBindingId,
      agents: row.agents as ProjectBindingRecord['agents'],
      status: row.status as ProjectBindingRecord['status'],
      ...(row.lastSyncedAt ? { lastSyncedAt: row.lastSyncedAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private context(row: typeof projectContextSnapshots.$inferSelect): ProjectContextSummary {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectSpaceId: row.projectSpaceId,
      bindingId: row.bindingId,
      deviceId: row.deviceId,
      artifactId: row.artifactId,
      digest: row.digest,
      selectionDigest: row.selectionDigest,
      fileCount: row.fileCount,
      totalBytes: row.totalBytes,
      agents: row.agents as ProjectContextSummary['agents'],
      scanEngineVersion: row.scanEngineVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
