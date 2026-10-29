import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';
import { InvalidPhoneNumberError } from '../errors/invalid-phone-number.error.js';
import { getPgError, PgErrorCode } from '../utils/pg-errors.js';

interface ResolvedError {
  statusCode: number;
  message: string;
  error?: string;
  details?: unknown;
}

// Single place that shapes error responses:
// { statusCode, error, message, details?, path, timestamp }.
// HttpExceptions keep their status; known DB/domain errors are mapped;
// anything else is logged and hidden behind a generic 500.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const resolved = this.resolve(exception);
    if (resolved.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorResponseDto = {
      statusCode: resolved.statusCode,
      error: resolved.error ?? STATUS_CODES[resolved.statusCode] ?? 'Error',
      message: resolved.message,
      ...(resolved.details !== undefined && { details: resolved.details }),
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(resolved.statusCode).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof InvalidPhoneNumberError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: exception.message,
        details: [{ field: 'phone', errors: [exception.message] }],
      };
    }

    const pg = getPgError(exception);
    switch (pg?.code) {
      case PgErrorCode.UniqueViolation:
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource already exists',
          details: { constraint: pg.constraint },
        };
      case PgErrorCode.ForeignKeyViolation:
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Referenced resource does not exist or is still in use',
          details: { constraint: pg.constraint },
        };
      case PgErrorCode.CheckViolation:
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Value violates a data constraint',
          details: { constraint: pg.constraint },
        };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong, please try again later',
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, message: payload };
    }

    const { message, error, details } = payload as {
      message?: string | string[];
      error?: string;
      details?: unknown;
    };
    // Nest's built-in exceptions put a list of messages in `message`.
    if (Array.isArray(message)) {
      return {
        statusCode,
        error,
        message: message.join('; '),
        details: details ?? message,
      };
    }
    return {
      statusCode,
      error,
      message: message ?? exception.message,
      details,
    };
  }
}
