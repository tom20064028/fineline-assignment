import express from 'express';
import type { Logger } from 'pino';
import { baseApp, finishApp } from '../../shared/http.js';
import { AppError } from '../../shared/errors.js';
import { id, object, parse } from '../../shared/validation.js';
import { publishRequestSchema, tokenRequestSchema } from '../../shared/schemas.js';
import { createLogger } from '../../shared/logger.js';
import { TokenService } from './auth.js';
import { JobStore } from './jobs.js';
import { PublishingWorker } from './worker.js';

export function createPublishingApp(tokens: TokenService, jobs: JobStore, worker: PublishingWorker, logger: Logger = createLogger('publishing-api')) {
  const app = baseApp(logger, () => worker.isAccepting);
  app.post('/oauth/token', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.is('application/x-www-form-urlencoded')) throw new AppError(400, 'INVALID_REQUEST', 'Use form-encoded credentials.');
    const body = object(req.body);
    if (body.grant_type !== undefined && body.grant_type !== 'client_credentials') throw new AppError(400, 'UNSUPPORTED_GRANT_TYPE', 'Unsupported grant type.');
    const credentials = parse(tokenRequestSchema, body);
    res.json(tokens.issue(credentials.client_id, credentials.client_secret));
  });
  // Authenticate before parsing JSON so malformed anonymous calls still receive 401.
  app.post('/publish', tokens.authenticate, express.json({ limit: '4kb' }), (req, res) => {
    if (!req.is('application/json')) throw new AppError(400, 'INVALID_REQUEST', 'Use a JSON request body.');
    const body = parse(publishRequestSchema, req.body);
    const result = jobs.accept(body.documentId, body.requestId, worker.isAccepting);
    if (result.created) worker.enqueue(result.job.jobId);
    req.log.info({ event: result.created ? 'publication_accepted' : 'publication_duplicate', jobId: result.job.jobId, documentId: body.documentId, requestId: body.requestId }, 'Publication accepted');
    res.status(202).location(`/jobs/${result.job.jobId}`).json({ jobId: result.job.jobId });
  });
  app.get('/jobs/:id', tokens.authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(jobs.get(id(req.params.id)));
  });
  finishApp(app);
  return app;
}
