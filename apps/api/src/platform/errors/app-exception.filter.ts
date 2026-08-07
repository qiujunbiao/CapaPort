import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
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
      reply.status(statusCode).send({ code: `HTTP_${statusCode}`, message, requestId });
      return;
    }

    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    });
  }
}
