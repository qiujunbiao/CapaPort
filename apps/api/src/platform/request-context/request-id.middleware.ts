import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';

type RequestWithId = { headers: Record<string, string | string[] | undefined>; requestId?: string };
type ResponseWithHeader = {
  header?: (name: string, value: string) => void;
  setHeader?: (name: string, value: string) => void;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: ResponseWithHeader, next: () => void): void {
    const supplied = request.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : randomUUID();
    request.requestId = requestId;
    if (response.header) response.header('x-request-id', requestId);
    else response.setHeader?.('x-request-id', requestId);
    next();
  }
}
