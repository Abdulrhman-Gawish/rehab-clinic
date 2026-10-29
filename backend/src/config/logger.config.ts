import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { NodeEnv, type EnvironmentVariables } from './env.validation.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

// Reuses a well-formed incoming X-Request-Id (e.g. from a proxy), otherwise
// generates one, and echoes it back so clients can quote it in bug reports.
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(
  env: Pick<EnvironmentVariables, 'NODE_ENV' | 'LOG_LEVEL'>,
): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId,
      // Never log credentials or tokens.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.newPassword',
          'req.body.refreshToken',
        ],
        censor: '[REDACTED]',
      },
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false,
      },
      transport:
        env.NODE_ENV === NodeEnv.Development
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  };
}
