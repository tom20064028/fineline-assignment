import express from 'express';
import type { ArchiveLink, DocumentFile, FinalStatus } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { baseApp, finishApp } from '../../shared/http.js';
import { id, object, text } from '../../shared/validation.js';

export interface SourceRecord { file?: DocumentFile; archive?: ArchiveLink; finalStatus?: FinalStatus }
export interface SourceEvent { operation: 'fetch' | 'link' | 'delete' | 'status'; documentId: string }
export interface SourceOptions {
  documents?: DocumentFile[];
  before?: (operation: SourceEvent['operation'], documentId: string) => void | Promise<void>;
  onEvent?: (event: SourceEvent) => void;
}

export function seededDocuments(): DocumentFile[] {
  return ['DOC001', 'DOC002', 'DOC003'].map((id) => ({
    id, filename: `${id}.txt`, contentType: 'text/plain', contentBase64: Buffer.from(`Document ${id}\n`).toString('base64'),
  }));
}

export function createSourceStub(options: SourceOptions = {}) {
  const documents = new Map<string, SourceRecord>((options.documents ?? seededDocuments()).map((file) => [file.id, { file: structuredClone(file) }]));
  const events: SourceEvent[] = [];
  const app = baseApp();
  app.use(express.json({ limit: '8mb' }));
  async function event(operation: SourceEvent['operation'], documentId: string) {
    const event = { operation, documentId };
    events.push(event);
    options.onEvent?.(event);
    await options.before?.(operation, documentId);
  }
  function get(documentId: string): SourceRecord {
    const record = documents.get(documentId);
    if (!record) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    return record;
  }
  app.get('/documents/:id', async (req, res) => {
    const documentId = id(req.params.id);
    await event('fetch', documentId);
    const file = get(documentId).file;
    if (!file) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document bytes are unavailable.');
    res.json(file);
  });
  app.put('/documents/:id/archive', async (req, res) => {
    const documentId = id(req.params.id);
    const body = object(req.body);
    const archiveUri = text(body.archiveUri, 'archiveUri');
    const sha256 = text(body.sha256, 'sha256', 64);
    if (!/^archive:\/[A-Za-z0-9_-]+\/document\.bin$/.test(archiveUri) || !/^[a-f0-9]{64}$/.test(sha256) || typeof body.sizeBytes !== 'number' || !Number.isSafeInteger(body.sizeBytes) || body.sizeBytes < 0 || body.sizeBytes > 5 * 1024 * 1024) {
      throw new AppError(400, 'INVALID_REQUEST', 'Invalid archive link.');
    }
    await event('link', documentId);
    const record = get(documentId);
    const archive = { archiveUri, sha256, sizeBytes: body.sizeBytes };
    if (record.archive && JSON.stringify(record.archive) !== JSON.stringify(archive)) throw new AppError(409, 'ARCHIVE_CONFLICT', 'Archive link already exists.');
    record.archive = archive;
    res.sendStatus(204);
  });
  app.delete('/documents/:id', async (req, res) => {
    const documentId = id(req.params.id);
    await event('delete', documentId);
    const record = get(documentId);
    if (!record.archive) throw new AppError(409, 'ARCHIVE_REQUIRED', 'An archive link is required before deletion.');
    delete record.file;
    res.sendStatus(204);
  });
  app.put('/documents/:id/status', async (req, res) => {
    const documentId = id(req.params.id);
    const body = object(req.body);
    const jobId = id(body.jobId);
    if (body.status !== 'Published' && body.status !== 'Error') throw new AppError(400, 'INVALID_REQUEST', 'Invalid final status.');
    const message = body.message === undefined ? undefined : text(body.message, 'message', 1024);
    if (body.status === 'Error' && message === undefined) throw new AppError(400, 'INVALID_REQUEST', 'Error status requires a message.');
    await event('status', documentId);
    const record = documents.get(documentId) ?? {};
    record.finalStatus = { jobId, status: body.status, ...(message === undefined ? {} : { message }) };
    documents.set(documentId, record);
    res.sendStatus(204);
  });
  finishApp(app);
  return { app, documents, events };
}
