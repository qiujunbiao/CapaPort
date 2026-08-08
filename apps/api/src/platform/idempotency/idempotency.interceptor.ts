import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '@agentdoor/contracts/auth';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { catchError, defer, from, map, mergeMap, type Observable, of, throwError } from 'rxjs';
import { AppError } from '../errors/app-error.js';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from './idempotency.store.js';

export type IdempotencyRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  auth?: AuthenticatedUser;
  tenant?: { organizationId: string };
};
export type IdempotencyResponse = { statusCode: number; status(code: number): unknown };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function fingerprintBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(body ?? null)))
    .digest('hex');
}

export function buildIdempotencyStorageKey(request: IdempotencyRequest, key: string): string {
  const tenantHeader = request.headers['x-organization-id'];
  const tenant = request.tenant?.organizationId ?? (typeof tenantHeader === 'string' ? tenantHeader : 'personal');
  const path = request.url.split('?')[0] ?? request.url;
  return [request.auth?.userId ?? 'anonymous', tenant, request.method.toUpperCase(), path, key].join('|');
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly tokenFactory: () => string;

  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Optional() @Inject('IDEMPOTENCY_TOKEN_FACTORY') tokenFactory?: () => string,
  ) {
    this.tokenFactory = tokenFactory ?? randomUUID;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<IdempotencyRequest>();
    const response = http.getResponse<IdempotencyResponse>();
    if (!this.requiresIdempotency(request)) return next.handle();
    const header = request.headers['idempotency-key'];
    const idempotencyKey = typeof header === 'string' ? header.trim() : '';
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', 400);
    }
    const storageKey = buildIdempotencyStorageKey(request, idempotencyKey);
    const fingerprint = fingerprintBody(request.body);
    const token = this.tokenFactory();
    return defer(() => from(this.store.reserve(storageKey, fingerprint, token))).pipe(
      mergeMap((reservation) => {
        if (reservation.state === 'conflict') {
          throw new AppError(
            'IDEMPOTENCY_KEY_CONFLICT',
            'This idempotency key was used with a different payload.',
            409,
          );
        }
        if (reservation.state === 'in_progress') {
          throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'A request with this idempotency key is still running.', 409);
        }
        if (reservation.state === 'replay') {
          response.status(reservation.statusCode);
          return of(reservation.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.store.complete(storageKey, fingerprint, token, response.statusCode, body)).pipe(map(() => body)),
          ),
          catchError((error: unknown) =>
            from(this.store.release(storageKey, token)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  private requiresIdempotency(request: IdempotencyRequest): boolean {
    return request.auth !== undefined && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  }
}
