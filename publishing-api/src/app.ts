import express from 'express';
import { finishApp } from '../../shared/http.js';
import { AppError } from '../../shared/errors.js';
import { id, object, text } from '../../shared/validation.js';
import { TokenService } from './auth.js';
import { JobStore } from './jobs.js';
import { PublishingWorker } from './worker.js';

export function createPublishingApp(tokens: TokenService, jobs: JobStore, worker: PublishingWorker) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.status(worker.isAccepting ? 200 : 503).json({ status: worker.isAccepting ? 'ok' : 'unavailable' }));
  app.post('/oauth/token', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.is('application/x-www-form-urlencoded')) throw new AppError(400, 'INVALID_REQUEST', 'Use form-encoded credentials.');
    const body = object(req.body);
    if (body.grant_type !== undefined && body.grant_type !== 'client_credentials') throw new AppError(400, 'UNSUPPORTED_GRANT_TYPE', 'Unsupported grant type.');
    res.json(tokens.issue(text(body.client_id, 'client_id'), text(body.client_secret, 'client_secret', 1024)));
  });
  // Authenticate before parsing JSON so malformed anonymous calls still receive 401.
  app.post('/publish', tokens.authenticate, express.json({ limit: '4kb' }), (req, res) => {
    if (!req.is('application/json')) throw new AppError(400, 'INVALID_REQUEST', 'Use a JSON request body.');
    const body = object(req.body);
    const result = jobs.accept(id(body.documentId), id(body.requestId), worker.isAccepting);
    if (result.created) worker.enqueue(result.job.jobId);
    res.status(202).location(`/jobs/${result.job.jobId}`).json({ jobId: result.job.jobId });
  });
  app.get('/jobs/:id', tokens.authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(jobs.get(id(req.params.id)));
  });
  finishApp(app);
  return app;
}
