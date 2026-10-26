import { randomUUID } from 'node:crypto';
import { pino, type DestinationStream, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { logLevelSchema } from './schemas.js';

export function createLogger(service: string, destination?: DestinationStream, level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  const parsed = logLevelSchema.safeParse(level);
  if (!parsed.success) throw new Error('Invalid LOG_LEVEL configuration.');
  return pino({
    name: service, level: parsed.data,
    redact: {
      paths: ['authorization', 'client_secret', 'access_token', 'contentBase64',
        'req.headers.authorization', 'req.body.client_secret', 'req.body.contentBase64',
        'res.body.access_token', 'body.client_secret', 'body.contentBase64', 'body.access_token'],
      remove: true,
    },
  }, destination);
}

export function requestLogging(logger: Logger) {
  return pinoHttp({
    logger,
    // Keep transport IDs distinct from the publication's idempotency requestId.
    genReqId: (_req, res) => {
      const traceId = randomUUID();
      res.setHeader('X-Request-Id', traceId);
      return traceId;
    },
    quietReqLogger: true,
    autoLogging: { ignore: (req) => req.url?.split('?')[0] === '/health' },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
      // Error objects can contain request bodies (for example JSON parser errors).
      err: () => ({ type: 'HttpError' }),
    },
  });
}
