import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../errors/app-error.js';
import {
  buildIdempotencyStorageKey,
  fingerprintBody,
  IdempotencyInterceptor,
  type IdempotencyRequest,
  type IdempotencyResponse,
} from './idempotency.interceptor.js';
import type { IdempotencyRecord, IdempotencyReservation, IdempotencyStore } from './idempotency.store.js';
import { RedisIdempotencyStore } from './idempotency.store.js';

class MemoryIdempotencyStore implements IdempotencyStore {
  readonly values = new Map<string, IdempotencyRecord>();

  async reserve(key: string, fingerprint: string, token: string): Promise<IdempotencyReservation> {
    const current = this.values.get(key);
    if (!current) {
      this.values.set(key, { state: 'pending', fingerprint, token });
      return { state: 'owner' };
    }
    if (current.fingerprint !== fingerprint) return { state: 'conflict' };
    if (current.state === 'pending') return { state: 'in_progress' };
    return { state: 'replay', statusCode: current.statusCode, body: current.body };
  }

  async complete(key: string, fingerprint: string, token: string, statusCode: number, body: unknown): Promise<void> {
    const current = this.values.get(key);
    if (current?.state === 'pending' && current.fingerprint === fingerprint && current.token === token) {
      this.values.set(key, { state: 'complete', fingerprint, statusCode, body });
    }
  }

  async release(key: string, token: string): Promise<void> {
    const current = this.values.get(key);
    if (current?.state === 'pending' && current.token === token) this.values.delete(key);
  }
}

function request(body: unknown, key = 'request-key-123'): IdempotencyRequest {
  return {
    method: 'POST',
    url: '/api/v1/capabilities',
    headers: { 'idempotency-key': key, 'x-organization-id': 'org-1' },
    body,
    auth: { userId: 'user-1', sessionId: 'session-1', recentlyAuthenticatedAt: 1 },
  };
}

function harness(interceptor: IdempotencyInterceptor, req: IdempotencyRequest, result: unknown) {
  const response: IdempotencyResponse = { statusCode: 201, status: vi.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }),
  } as ExecutionContext;
  const handler: CallHandler = { handle: vi.fn(() => of(result)) };
  return { response, handler, value: () => firstValueFrom(interceptor.intercept(context, handler)) };
}

describe('IdempotencyInterceptor', () => {
  it('replays a completed response without invoking the handler twice', async () => {
    const interceptor = new IdempotencyInterceptor(new MemoryIdempotencyStore(), () => 'token-1');
    const first = harness(interceptor, request({ name: 'A' }), { id: 'cap-1' });
    await expect(first.value()).resolves.toEqual({ id: 'cap-1' });
    const replay = harness(interceptor, request({ name: 'A' }), { id: 'cap-2' });
    await expect(replay.value()).resolves.toEqual({ id: 'cap-1' });
    expect(replay.handler.handle).not.toHaveBeenCalled();
    expect(replay.response.status).toHaveBeenCalledWith(201);
  });

  it('rejects concurrent reuse while the first request owns the reservation', async () => {
    const store = new MemoryIdempotencyStore();
    const interceptor = new IdempotencyInterceptor(store, () => 'token-1');
    const req = request({ name: 'A' });
    await store.reserve(buildIdempotencyStorageKey(req, 'request-key-123'), fingerprintBody(req.body), 'held');
    const attempt = harness(interceptor, req, {});
    await expect(attempt.value()).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    } satisfies Partial<AppError>);
  });

  it('rejects reuse of a key with a different body', async () => {
    const interceptor = new IdempotencyInterceptor(new MemoryIdempotencyStore(), () => 'token-1');
    await harness(interceptor, request({ name: 'A' }), { id: 'cap-1' }).value();
    await expect(harness(interceptor, request({ name: 'B' }), {}).value()).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    } satisfies Partial<AppError>);
  });

  it('stores reservations with a bounded 24-hour expiry', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      eval: vi.fn(),
    };
    const store = new RedisIdempotencyStore({ client } as never);
    await expect(store.reserve('storage-key', 'fingerprint', 'owner-token')).resolves.toEqual({ state: 'owner' });
    expect(client.set).toHaveBeenCalledWith('idempotency:storage-key', expect.any(String), 'EX', 86_400, 'NX');
  });
});
