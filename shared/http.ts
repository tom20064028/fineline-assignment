import express, { type ErrorRequestHandler, type Express } from 'express';
import { AppError } from './errors.js';

export function baseApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  return app;
}
export function finishApp(app: Express): void {
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.')));
  const handler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message }, ...(error.jobId ? { jobId: error.jobId } : {}) });
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    } else if (error instanceof SyntaxError || error instanceof URIError || (error && typeof error === 'object' && 'status' in error && error.status === 400)) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Malformed request.' } });
    } else {
      console.error('Unexpected request error', error);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    }
  };
  app.use(handler);
}
