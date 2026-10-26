import express from 'express';
import type { Logger } from 'pino';
import type { ArchiveLink, DocumentFile, FinalStatus } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { baseApp, finishApp } from '../../shared/http.js';
import { id, parse } from '../../shared/validation.js';
import { archiveLinkSchema, finalStatusSchema } from '../../shared/schemas.js';
import { createLogger } from '../../shared/logger.js';

export interface SourceRecord { file?: DocumentFile; archive?: ArchiveLink; finalStatus?: FinalStatus }
export interface SourceEvent { operation: 'fetch' | 'link' | 'delete' | 'status'; documentId: string }
export interface SourceOptions {
  logger?: Logger;
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
  const app = baseApp(options.logger ?? createLogger('source-stub'));
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
    const archive = parse(archiveLinkSchema, req.body, 'INVALID_REQUEST', 'Invalid archive link.');
    await event('link', documentId);
    const record = get(documentId);
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
    const status = parse(finalStatusSchema, req.body, 'INVALID_REQUEST', 'Invalid final status.');
    await event('status', documentId);
    const record = documents.get(documentId) ?? {};
    record.finalStatus = status;
    documents.set(documentId, record);
    res.sendStatus(204);
  });
  finishApp(app);
  return { app, documents, events };
}
