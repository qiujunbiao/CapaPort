import { Inject, Injectable } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service.js';

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
const IDEMPOTENCY_TTL_SECONDS = 86_400;

export type IdempotencyRecord =
  | { state: 'pending'; fingerprint: string; token: string }
  | { state: 'complete'; fingerprint: string; statusCode: number; body: unknown };
export type IdempotencyReservation =
  | { state: 'owner' }
  | { state: 'in_progress' }
  | { state: 'conflict' }
  | { state: 'replay'; statusCode: number; body: unknown };

export interface IdempotencyStore {
  reserve(key: string, fingerprint: string, token: string): Promise<IdempotencyReservation>;
  complete(key: string, fingerprint: string, token: string, statusCode: number, body: unknown): Promise<void>;
  release(key: string, token: string): Promise<void>;
}

@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(@Inject('REDIS_SERVICE') private readonly redis: RedisService) {}

  async reserve(key: string, fingerprint: string, token: string): Promise<IdempotencyReservation> {
    const redisKey = `idempotency:${key}`;
    const pending: IdempotencyRecord = { state: 'pending', fingerprint, token };
    const acquired = await this.redis.client.set(
      redisKey,
      JSON.stringify(pending),
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX',
    );
    if (acquired === 'OK') return { state: 'owner' };
    const encoded = await this.redis.client.get(redisKey);
    if (!encoded) return this.reserve(key, fingerprint, token);
    const record = JSON.parse(encoded) as IdempotencyRecord;
    if (record.fingerprint !== fingerprint) return { state: 'conflict' };
    if (record.state === 'pending') return { state: 'in_progress' };
    return { state: 'replay', statusCode: record.statusCode, body: record.body };
  }

  async complete(key: string, fingerprint: string, token: string, statusCode: number, body: unknown): Promise<void> {
    const redisKey = `idempotency:${key}`;
    const complete: IdempotencyRecord = { state: 'complete', fingerprint, statusCode, body: body ?? null };
    await this.redis.client.eval(
      "local current = redis.call('GET', KEYS[1]); if not current then return 0 end; local value = cjson.decode(current); if value.state ~= 'pending' or value.token ~= ARGV[1] or value.fingerprint ~= ARGV[2] then return 0 end; redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4]); return 1",
      1,
      redisKey,
      token,
      fingerprint,
      JSON.stringify(complete),
      IDEMPOTENCY_TTL_SECONDS,
    );
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.client.eval(
      "local current = redis.call('GET', KEYS[1]); if not current then return 0 end; local value = cjson.decode(current); if value.state == 'pending' and value.token == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
      1,
      `idempotency:${key}`,
      token,
    );
  }
}
