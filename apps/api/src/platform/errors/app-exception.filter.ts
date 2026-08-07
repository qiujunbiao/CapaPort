import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { platformMetrics } from '../telemetry/metrics-registry.js';
import { platformLogger } from '../telemetry/structured-logger.js';
import { AppError } from './app-error.js';

type RequestWithId = { requestId?: string; raw?: { requestId?: string } };
type HttpReply = { status(code: number): HttpReply; send(payload: unknown): void };

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<RequestWithId>();
    const reply = host.switchToHttp().getResponse<HttpReply>();
    const requestId = request.requestId ?? request.raw?.requestId;

    if (exception instanceof AppError) {
      platformMetrics.increment('agentdoor_http_errors_total', {
        code: exception.code,
        status: String(exception.statusCode),
      });
      if (
        exception.code === 'ACCESS_DENIED' ||
        exception.code === 'TENANT_ACCESS_DENIED' ||
        exception.code === 'AUTH_REFRESH_REPLAY' ||
        exception.code.includes('SCAN') ||
        exception.code.includes('INSTALLATION') ||
        exception.code.includes('UPLOAD')
      ) {
        platformLogger.warn('security.business_error', {
          requestId,
          code: exception.code,
          statusCode: exception.statusCode,
        });
      }
      reply.status(exception.statusCode).send({
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : exception.message;
      platformMetrics.increment('agentdoor_http_errors_total', {
        code: `HTTP_${statusCode}`,
        status: String(statusCode),
      });
      reply.status(statusCode).send({ code: `HTTP_${statusCode}`, message, requestId });
      return;
    }

    platformMetrics.increment('agentdoor_http_errors_total', { code: 'INTERNAL_ERROR', status: '500' });
    platformLogger.error('http.request.unhandled_exception', { requestId, error: exception });

    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    });
  }
}
