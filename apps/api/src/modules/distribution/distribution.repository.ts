import { randomUUID } from 'node:crypto';
import type { AgentId } from '@agentdoor/contracts/capabilities';
import type { UpdateDeviceRequest } from '@agentdoor/contracts/distribution';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { artifacts, capabilityVersions } from '../../db/schema/capabilities.js';
import { devices } from '../../db/schema/distribution.js';
import { auditLogs } from '../../db/schema/organizations.js';
import { outboxEvents } from '../../db/schema/outbox.js';
import type { DatabaseService } from '../../platform/database/database.service.js';
import { AppError } from '../../platform/errors/app-error.js';
import type {
  DeviceRecord,
  DistributionDataStore,
  DistributionVersionRecord,
  InstallationRecord,
} from './distribution.service.js';

type InstallationRow = {
  id: string;
  organization_id: string;
  user_id: string;
  device_id: string;
  capability_id: string;
  version_id: string;
  version_space_id: string;
  installed_digest: string;
  agent: string;
  status: string;
  failure_code: string | null;
  idempotency_key: string;
  installed_at: Date | null;
  updated_at: Date;
};

@Injectable()
export class DistributionRepository implements DistributionDataStore {
  constructor(@Inject('DATABASE_SERVICE') private readonly database: DatabaseService) {}

  async registerDevice(input: DeviceRecord): Promise<DeviceRecord> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(devices).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        name: input.name,
        platform: input.platform,
        appVersion: input.appVersion,
        supportedAgents: [...input.supportedAgents],
        status: input.status,
        lastSeenAt: input.lastSeenAt,
      });
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: 'device.registered',
        resourceType: 'device',
        resourceId: input.id,
        metadata: { platform: input.platform, supportedAgents: input.supportedAgents },
      });
      await transaction.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: 'device.registered',
        aggregateType: 'device',
        aggregateId: input.id,
        organizationId: input.organizationId,
        payload: { platform: input.platform, supportedAgents: input.supportedAgents },
      });
    });
    return input;
  }

  async listDevices(organizationId: string, userId: string): Promise<DeviceRecord[]> {
    const rows = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId)))
      .orderBy(desc(devices.updatedAt));
    return rows.map((row) => this.device(row));
  }

  async findDevice(organizationId: string, userId: string, deviceId: string): Promise<DeviceRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(devices)
      .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId), eq(devices.id, deviceId)))
      .limit(1);
    return row ? this.device(row) : undefined;
  }

  async updateDevice(
    organizationId: string,
    userId: string,
    deviceId: string,
    input: UpdateDeviceRequest,
  ): Promise<DeviceRecord> {
    const set: Partial<typeof devices.$inferInsert> = { lastSeenAt: new Date(), updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.appVersion !== undefined) set.appVersion = input.appVersion;
    if (input.supportedAgents !== undefined) set.supportedAgents = [...new Set(input.supportedAgents)];
    const [row] = await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(devices)
        .set(set)
        .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId), eq(devices.id, deviceId)))
        .returning();
      if (!updated[0]) this.denied();
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId,
        actorUserId: userId,
        action: 'device.updated',
        resourceType: 'device',
        resourceId: deviceId,
        metadata: { fields: Object.keys(input).sort() },
      });
      return updated;
    });
    if (!row) this.denied();
    return this.device(row);
  }

  async revokeDevice(organizationId: string, userId: string, deviceId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(devices)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId), eq(devices.id, deviceId)))
        .returning({ id: devices.id });
      if (!updated[0]) this.denied();
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId,
        actorUserId: userId,
        action: 'device.revoked',
        resourceType: 'device',
        resourceId: deviceId,
        metadata: {},
      });
      await transaction.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: 'device.revoked',
        aggregateType: 'device',
        aggregateId: deviceId,
        organizationId,
        payload: {},
      });
    });
  }

  async findVersion(organizationId: string, versionId: string): Promise<DistributionVersionRecord | undefined> {
    const [row] = await this.database.db
      .select({ version: capabilityVersions, objectKey: artifacts.objectKey })
      .from(capabilityVersions)
      .innerJoin(
        artifacts,
        and(eq(artifacts.organizationId, organizationId), eq(artifacts.id, capabilityVersions.artifactId)),
      )
      .where(and(eq(capabilityVersions.organizationId, organizationId), eq(capabilityVersions.id, versionId)))
      .limit(1);
    return row ? this.version(row.version, row.objectKey) : undefined;
  }

  async listVersions(
    organizationId: string,
    capabilityId: string,
    spaceId: string,
  ): Promise<DistributionVersionRecord[]> {
    const rows = await this.database.db
      .select({ version: capabilityVersions, objectKey: artifacts.objectKey })
      .from(capabilityVersions)
      .innerJoin(
        artifacts,
        and(eq(artifacts.organizationId, organizationId), eq(artifacts.id, capabilityVersions.artifactId)),
      )
      .where(
        and(
          eq(capabilityVersions.organizationId, organizationId),
          eq(capabilityVersions.capabilityId, capabilityId),
          eq(capabilityVersions.spaceId, spaceId),
        ),
      )
      .orderBy(desc(capabilityVersions.publishedAt));
    return rows.map((row) => this.version(row.version, row.objectKey));
  }

  async recordDownloadPlan(input: Parameters<DistributionDataStore['recordDownloadPlan']>[0]): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const metadata = {
        deviceId: input.deviceId,
        capabilityId: input.capabilityId,
        versionId: input.versionId,
        agent: input.agent,
        expiresIn: input.expiresIn,
      };
      await transaction.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: 'capability.download_authorized',
        resourceType: 'capability_version',
        resourceId: input.versionId,
        metadata,
      });
      await transaction.insert(outboxEvents).values({
        id: randomUUID(),
        eventType: 'capability.download_authorized',
        aggregateType: 'capability_version',
        aggregateId: input.versionId,
        organizationId: input.organizationId,
        payload: metadata,
      });
    });
  }

  async reportInstallation(input: Parameters<DistributionDataStore['reportInstallation']>[0]) {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await this.findByIdempotency(client, input.organizationId, input.userId, input.idempotencyKey);
      if (replay) {
        this.assertReplayMatches(replay, input);
        await client.query('COMMIT');
        return this.installation(replay);
      }
      const now = new Date();
      await client.query(
        `INSERT INTO installations
          (id,organization_id,user_id,device_id,capability_id,version_id,version_space_id,installed_digest,
           agent,status,failure_code,idempotency_key,installed_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          input.installationId,
          input.organizationId,
          input.userId,
          input.deviceId,
          input.capabilityId,
          input.versionId,
          input.versionSpaceId,
          input.digest,
          input.agent,
          input.outcome,
          input.failureCode ?? null,
          input.idempotencyKey,
          input.outcome === 'installed' ? now : null,
          now,
        ],
      );
      await client.query(
        `INSERT INTO installation_analytics
          (id,organization_id,capability_id,version_id,agent,outcome,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), input.organizationId, input.capabilityId, input.versionId, input.agent, input.outcome, now],
      );
      const metadata = {
        installationId: input.installationId,
        capabilityId: input.capabilityId,
        versionId: input.versionId,
        agent: input.agent,
        outcome: input.outcome,
        ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      };
      await this.insertAuditAndOutbox(
        client,
        input.organizationId,
        input.userId,
        `installation.${input.outcome}`,
        input.installationId,
        metadata,
      );
      const created = await client.query<InstallationRow>('SELECT * FROM installations WHERE id=$1', [
        input.installationId,
      ]);
      const row = created.rows[0];
      if (!row) throw new AppError('INSTALLATION_WRITE_FAILED', 'Installation report produced no record.', 500);
      await client.query('COMMIT');
      return this.installation(row);
    } catch (error) {
      await client.query('ROLLBACK');
      if (this.constraint(error) === 'installations_user_idempotency_uidx') {
        const replay = await this.database.pool.query<InstallationRow>(
          `SELECT * FROM installations
            WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3`,
          [input.organizationId, input.userId, input.idempotencyKey],
        );
        const row = replay.rows[0];
        if (row) {
          this.assertReplayMatches(row, input);
          return this.installation(row);
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findInstallation(
    organizationId: string,
    userId: string,
    installationId: string,
  ): Promise<InstallationRecord | undefined> {
    const result = await this.database.pool.query<InstallationRow>(
      'SELECT * FROM installations WHERE organization_id=$1 AND user_id=$2 AND id=$3',
      [organizationId, userId, installationId],
    );
    return result.rows[0] ? this.installation(result.rows[0]) : undefined;
  }

  async listInstallations(organizationId: string, userId: string): Promise<InstallationRecord[]> {
    const result = await this.database.pool.query<InstallationRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (device_id,capability_id,agent) *
           FROM installations
          WHERE organization_id=$1 AND user_id=$2
          ORDER BY device_id,capability_id,agent,updated_at DESC,created_at DESC,id DESC
       ) current_installations
       ORDER BY updated_at DESC,created_at DESC,id DESC`,
      [organizationId, userId],
    );
    return result.rows.map((row) => this.installation(row));
  }

  private async insertAuditAndOutbox(
    client: PoolClient,
    organizationId: string,
    userId: string,
    action: string,
    installationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
        (id,organization_id,actor_user_id,action,resource_type,resource_id,metadata)
       VALUES ($1,$2,$3,$4,'installation',$5,$6::jsonb)`,
      [randomUUID(), organizationId, userId, action, installationId, JSON.stringify(metadata)],
    );
    await client.query(
      `INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,organization_id,payload)
       VALUES ($1,$2,'installation',$3,$4,$5::jsonb)`,
      [randomUUID(), action, installationId, organizationId, JSON.stringify(metadata)],
    );
  }

  private findByIdempotency(client: PoolClient, organizationId: string, userId: string, idempotencyKey: string) {
    return client
      .query<InstallationRow>(
        `SELECT * FROM installations
          WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [organizationId, userId, idempotencyKey],
      )
      .then((result) => result.rows[0]);
  }

  private assertReplayMatches(
    row: InstallationRow,
    input: Parameters<DistributionDataStore['reportInstallation']>[0],
  ): void {
    if (
      row.device_id !== input.deviceId ||
      row.capability_id !== input.capabilityId ||
      row.version_id !== input.versionId ||
      row.agent !== input.agent ||
      row.status !== input.outcome ||
      row.failure_code !== (input.failureCode ?? null)
    ) {
      throw new AppError('IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was used for another request.', 409);
    }
  }

  private device(row: typeof devices.$inferSelect): DeviceRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      name: row.name,
      platform: row.platform as DeviceRecord['platform'],
      appVersion: row.appVersion,
      supportedAgents: row.supportedAgents as AgentId[],
      status: row.status as DeviceRecord['status'],
      lastSeenAt: row.lastSeenAt,
    };
  }

  private version(row: typeof capabilityVersions.$inferSelect, objectKey: string): DistributionVersionRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      capabilityId: row.capabilityId,
      spaceId: row.spaceId,
      version: row.version,
      artifactId: row.artifactId,
      objectKey,
      contentDigest: row.contentDigest,
      manifest: row.manifest as DistributionVersionRecord['manifest'],
      status: row.status as DistributionVersionRecord['status'],
      publishedAt: row.publishedAt,
    };
  }

  private installation(row: InstallationRow): InstallationRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      deviceId: row.device_id,
      capabilityId: row.capability_id,
      versionId: row.version_id,
      agent: row.agent as AgentId,
      status: row.status as InstallationRecord['status'],
      ...(row.failure_code ? { failureCode: row.failure_code } : {}),
      ...(row.installed_at ? { installedAt: row.installed_at } : {}),
      updatedAt: row.updated_at,
    };
  }

  private constraint(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
    return typeof error.constraint === 'string' ? error.constraint : undefined;
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this distribution resource.', 403);
  }
}
