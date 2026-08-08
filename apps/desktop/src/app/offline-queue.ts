import type { CloudClient, Session } from './types';

export type OfflineWrite = {
  id: string;
  operation: string;
  payloadJson: string;
  idempotencyKey: string;
  attempts: number;
};

export type RescheduleInput = {
  id: string;
  errorCode: string;
  availableAt: string;
  permanentlyFailed: boolean;
};

export interface OfflineWriteStore {
  enqueueWrite(write: OfflineWrite & { availableAt: string }): Promise<void>;
  claimReadyWrites(now: string, limit: number): Promise<OfflineWrite[]>;
  completeWrite(id: string): Promise<void>;
  rescheduleWrite(input: RescheduleInput): Promise<void>;
  retryFailedWrites(now: string): Promise<void>;
}

type QueueOptions = { online: () => boolean; now?: () => Date; maxAttempts?: number };
type OperationHandler = (payload: unknown, idempotencyKey: string) => Promise<unknown>;

const permanentCodes = new Set([
  'ACCESS_DENIED',
  'AUTH_REQUIRED',
  'TENANT_ACCESS_DENIED',
  'TENANT_REQUIRED',
  'VALIDATION_ERROR',
]);

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'NETWORK_ERROR';
}

export class OfflineWriteQueue {
  private readonly now: () => Date;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: OfflineWriteStore,
    private readonly options: QueueOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 8;
  }

  async run<T>(
    operation: string,
    payload: unknown,
    send: (idempotencyKey: string) => Promise<T>,
  ): Promise<
    | { state: 'completed'; id: string; idempotencyKey: string; value: T }
    | { state: 'queued' | 'failed'; id: string; idempotencyKey: string }
  > {
    const id = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const now = this.now();
    await this.store.enqueueWrite({
      id,
      operation,
      payloadJson: JSON.stringify(payload),
      idempotencyKey,
      attempts: 0,
      availableAt: now.toISOString(),
    });
    if (!this.options.online()) return { state: 'queued', id, idempotencyKey };
    try {
      const value = await send(idempotencyKey);
      await this.store.completeWrite(id);
      return { state: 'completed', id, idempotencyKey, value };
    } catch (error) {
      const permanentlyFailed = permanentCodes.has(errorCode(error));
      await this.reschedule({ id, attempts: 0 }, error, permanentlyFailed);
      return { state: permanentlyFailed ? 'failed' : 'queued', id, idempotencyKey };
    }
  }

  async syncNow(
    handlers: Record<string, OperationHandler>,
  ): Promise<{ completed: number; queued: number; failed: number }> {
    if (!this.options.online()) return { completed: 0, queued: 0, failed: 0 };
    const writes = await this.store.claimReadyWrites(this.now().toISOString(), 25);
    const result = { completed: 0, queued: 0, failed: 0 };
    for (const write of writes) {
      const handler = handlers[write.operation];
      if (!handler) {
        await this.reschedule(write, { code: 'UNSUPPORTED_OPERATION' }, true);
        result.failed += 1;
        continue;
      }
      try {
        await handler(JSON.parse(write.payloadJson) as unknown, write.idempotencyKey);
        await this.store.completeWrite(write.id);
        result.completed += 1;
      } catch (error) {
        const permanent = permanentCodes.has(errorCode(error)) || write.attempts + 1 >= this.maxAttempts;
        await this.reschedule(write, error, permanent);
        result[permanent ? 'failed' : 'queued'] += 1;
      }
    }
    return result;
  }

  retryFailed(): Promise<void> {
    return this.store.retryFailedWrites(this.now().toISOString());
  }

  private reschedule(write: Pick<OfflineWrite, 'id' | 'attempts'>, error: unknown, permanentlyFailed: boolean) {
    const delay = Math.min(300_000, 1_000 * 2 ** write.attempts);
    return this.store.rescheduleWrite({
      id: write.id,
      errorCode: errorCode(error),
      availableAt: new Date(this.now().getTime() + delay).toISOString(),
      permanentlyFailed,
    });
  }
}

type SubmitPublicationInput = Parameters<CloudClient['submitPublication']>[0];
type ReportInstallationInput = Parameters<CloudClient['reportInstallation']>[0];
type QueuedSubmitPublication = Omit<SubmitPublicationInput, 'session' | 'idempotencyKey'>;
type QueuedInstallationReport = Omit<ReportInstallationInput, 'session' | 'idempotencyKey'>;

export function createQueuedCloudClient(cloud: CloudClient, queue: OfflineWriteQueue): CloudClient {
  return {
    ...cloud,
    submitPublication: async (input) => {
      const { session, idempotencyKey: _ignored, ...payload } = input;
      const outcome = await queue.run('publication.submit', payload, (idempotencyKey) =>
        cloud.submitPublication({ ...payload, session, idempotencyKey }),
      );
      if (outcome.state === 'completed') return outcome.value;
      if (outcome.state === 'failed') throw new Error('发布请求无权限执行，已移入失败队列');
      return { publicationId: `queued:${outcome.id}`, queued: true };
    },
    reportInstallation: async (input) => {
      const { session, idempotencyKey: _ignored, ...payload } = input;
      const outcome = await queue.run('installation.report', payload, (idempotencyKey) =>
        cloud.reportInstallation({ ...payload, session, idempotencyKey }),
      );
      if (outcome.state === 'failed') throw new Error('安装状态无权限上报，已移入失败队列');
    },
  };
}

export function queuedCloudHandlers(cloud: CloudClient, session: Session): Record<string, OperationHandler> {
  return {
    'publication.submit': (payload, idempotencyKey) =>
      cloud.submitPublication({ ...(payload as QueuedSubmitPublication), session, idempotencyKey }),
    'installation.report': (payload, idempotencyKey) =>
      cloud.reportInstallation({ ...(payload as QueuedInstallationReport), session, idempotencyKey }),
  };
}
