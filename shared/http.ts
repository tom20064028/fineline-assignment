import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Logger } from 'pino';
import { AppError } from './errors.js';
import { createLogger, requestLogging } from './logger.js';

export function baseApp(logger: Logger = createLogger('http'), ready: () => boolean = () => true): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogging(logger));
  app.get('/health', (_req, res) => res.status(ready() ? 200 : 503).json({ status: ready() ? 'ok' : 'unavailable' }));
  return app;
}
export function finishApp(app: Express): void {
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));
  const handler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message }, ...(error.jobId ? { jobId: error.jobId } : {}) });
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    } else if (error instanceof SyntaxError || error instanceof URIError || (error && typeof error === 'object' && 'status' in error && error.status === 400)) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Malformed request.' } });
    } else {
      req.log.error({ event: 'request_error', code: 'INTERNAL_ERROR' }, 'Unexpected request error');
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    }
  };
  app.use(handler);
}
