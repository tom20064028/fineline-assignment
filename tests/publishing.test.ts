import { afterEach, describe, expect, it } from 'vitest';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../shared/errors.js';
import { acceptance, gate, harness, until, type HarnessOptions } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
async function setup(options: HarnessOptions = {}) {
  const h = await harness(options);
  cleanups.push(h.close);
  return h;
}
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

describe('publishing workflow over HTTP', () => {
  it('accepts without waiting for Source and executes the full workflow in order', async () => {
    const blocked = gate();
    const events: string[] = [];
    const h = await setup({ source: { before: (op) => op === 'fetch' ? blocked.promise : undefined, onEvent: (e) => { events.push(e.operation); } }, vendor: { onRequest: () => { events.push('deliver'); } } });
    try {
      const response = await h.publish();
      expect(response.status).toBe(202);
      const { jobId } = await acceptance(response);
      expect(response.headers.get('location')).toBe(`/jobs/${jobId}`);
      expect(h.jobs.get(jobId).status).toBe('running');
      expect(h.vendor.requests).toHaveLength(0);
      blocked.release();
      const result = await h.complete(jobId);
      expect(result).toMatchObject({ status: 'done', sourceStatusWritten: true, vendorAttempts: 1, deliveryOutcome: 'delivered' });
      expect(events).toEqual(['fetch', 'link', 'delete', 'deliver', 'status']);
      const source = h.source.documents.get('DOC001');
      expect(source?.file).toBeUndefined();
      expect(source?.finalStatus).toEqual({ jobId, status: 'Published' });
      const archived = await readFile(join(h.root, jobId, 'document.bin'));
      const delivered = h.vendor.receipts.get(jobId)?.delivery;
      expect(delivered?.contentBase64).toBe(archived.toString('base64'));
      const snapshot = await h.request(`/jobs/${jobId}`);
      expect(await snapshot.json()).toEqual(result);
    } finally { blocked.release(); }
  });

  it('deduplicates concurrent requests while running and after completion', async () => {
    const blocked = gate();
    const h = await setup({ source: { before: (op) => op === 'fetch' ? blocked.promise : undefined } });
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, () => h.publish()));
      expect(responses.every((r) => r.status === 202)).toBe(true);
      const bodies = await Promise.all(responses.map(acceptance));
      const jobId: string = bodies[0]!.jobId;
      expect(new Set(bodies.map((b) => b.jobId)).size).toBe(1);
      blocked.release();
      await h.complete(jobId);
      expect(await (await h.publish()).json()).toEqual({ jobId });
      expect(h.source.events.filter((e) => e.operation === 'fetch')).toHaveLength(1);
      expect(h.vendor.receipts.size).toBe(1);
      expect(h.vendor.requests).toHaveLength(1);
    } finally { blocked.release(); }
  });

  it('rejects request and document conflicts', async () => {
    const h = await setup();
    const { jobId } = await acceptance(await h.publish());
    expect((await h.publish('DOC002', 'REQ001')).status).toBe(409);
    const conflict = await h.publish('DOC001', 'REQ002');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ jobId, error: { code: 'DOCUMENT_ALREADY_SUBMITTED' } });
    // A rejected request ID is not reserved for the conflicting document.
    expect((await h.publish('DOC002', 'REQ002')).status).toBe(202);
  });

  it('returns 503 at capacity but still resolves existing duplicates', async () => {
    const h = await setup({ capacity: 1 });
    const { jobId } = await acceptance(await h.publish());
    expect((await h.publish('DOC002', 'REQ002')).status).toBe(503);
    expect(await (await h.publish()).json()).toEqual({ jobId });
    expect(() => h.jobs.get('REQ002')).toThrow();
  });

  it('retries transient Vendor failures with a stable key and payload', async () => {
    const h = await setup({ vendor: { outcomes: [500, 500, 'success'] } });
    const { jobId } = await acceptance(await h.publish());
    expect(await h.complete(jobId)).toMatchObject({ status: 'done', vendorAttempts: 3 });
    expect(h.waits).toEqual([250, 500]);
    expect(new Set(h.vendor.requests.map((r) => r.key))).toEqual(new Set([jobId]));
    expect(new Set(h.vendor.requests.map((r) => JSON.stringify(r.delivery))).size).toBe(1);
    expect(h.vendor.receipts.size).toBe(1);
  });

  it.each([[500, 4], [400, 1]] as const)('reports Vendor %i failures after %i attempts and retains the archive', async (status, attempts) => {
    const h = await setup({ vendor: { outcomes: [status, status, status, status] } });
    const { jobId } = await acceptance(await h.publish());
    expect(await h.complete(jobId)).toMatchObject({ status: 'failed', sourceStatusWritten: true, vendorAttempts: attempts, error: { code: `VENDOR_HTTP_${status}` } });
    expect(h.source.documents.get('DOC001')?.finalStatus).toMatchObject({ status: 'Error', jobId });
    expect(h.vendor.receipts.size).toBe(0);
    expect(await readFile(join(h.root, jobId, 'document.bin'), 'utf8')).toBe('Document DOC001\n');
    expect(await (await h.publish()).json()).toEqual({ jobId });
    expect(h.vendor.requests).toHaveLength(attempts);
  });

  it('deduplicates a delivery accepted before the connection is lost', async () => {
    const h = await setup({ vendor: { outcomes: ['accept-disconnect'] } });
    const { jobId } = await acceptance(await h.publish());
    expect(await h.complete(jobId)).toMatchObject({ status: 'done', vendorAttempts: 2, deliveryOutcome: 'delivered' });
    expect(h.vendor.requests).toHaveLength(2);
    expect(h.vendor.receipts.size).toBe(1);
  });

  it.each(['save', 'read'] as const)('prevents Source deletion if archive %s fails during storage verification', async (failure) => {
    const h = await setup({ archive: (local) => ({
      save: async (jobId, file) => {
        if (failure === 'save') throw new AppError(500, 'ARCHIVE_FAILED', 'Archive unavailable.');
        const record = await local.save(jobId, file);
        await local.read(jobId, { ...record, sha256: '0'.repeat(64) });
        return record;
      },
      read: local.read.bind(local),
    }) });
    const { jobId } = await acceptance(await h.publish());
    expect((await h.complete(jobId)).status).toBe('failed');
    expect(h.source.documents.get('DOC001')?.file).toBeDefined();
    expect(h.source.events.map((e) => e.operation)).toEqual(['fetch', 'status']);
    expect(h.vendor.requests).toHaveLength(0);
  });

  it.each(['link', 'delete'] as const)('reports Source %s failure without delivery', async (failure) => {
    const h = await setup({ source: { before: (op) => { if (op === failure) throw new AppError(409, 'SOURCE_CONFLICT', 'Cannot mutate Source.'); } } });
    const { jobId } = await acceptance(await h.publish());
    expect((await h.complete(jobId)).status).toBe('failed');
    expect(h.source.documents.get('DOC001')?.file).toBeDefined();
    expect(h.vendor.requests).toHaveLength(0);
    if (failure === 'link') expect(h.source.events.some((e) => e.operation === 'delete')).toBe(false);
  });

  it('rechecks archive integrity after linking before deleting Source bytes', async () => {
    const h = await setup({
      source: { before: async (op) => {
        if (op === 'link') {
          const [jobId] = await readdir(h.root);
          await writeFile(join(h.root, jobId!, 'document.bin'), 'corrupted');
        }
      } },
    });
    const { jobId } = await acceptance(await h.publish());
    expect(await h.complete(jobId)).toMatchObject({ status: 'failed', error: { code: 'ARCHIVE_INVALID' } });
    expect(h.source.documents.get('DOC001')?.file).toBeDefined();
    expect(h.source.events.some((e) => e.operation === 'delete')).toBe(false);
    expect(h.vendor.requests).toHaveLength(0);
  });

  it('retries Source transient failures three times before reporting Error', async () => {
    const h = await setup({ source: { before: (op) => { if (op === 'fetch') throw new AppError(503, 'UNAVAILABLE', 'Source unavailable.'); } } });
    const { jobId } = await acceptance(await h.publish());
    expect(await h.complete(jobId)).toMatchObject({ status: 'failed', error: { code: 'SOURCE_HTTP_503' } });
    expect(h.source.events.map((e) => e.operation)).toEqual(['fetch', 'fetch', 'fetch', 'status']);
    expect(h.waits).toEqual([250, 500]);
    expect(h.source.documents.get('DOC001')?.file).toBeDefined();
    expect(h.vendor.requests).toHaveLength(0);
  });

  it('writes Error for a missing document using metadata only', async () => {
    const h = await setup();
    const { jobId } = await acceptance(await h.publish('MISSING'));
    expect(await h.complete(jobId)).toMatchObject({ status: 'failed', error: { code: 'SOURCE_HTTP_404' }, sourceStatusWritten: true });
    expect(h.source.documents.get('MISSING')).toMatchObject({ finalStatus: { status: 'Error' } });
    expect(await readdir(h.root)).toHaveLength(0);
  });

  it('keeps reporting jobs nonterminal and never redelivers when Source recovers', async () => {
    let unavailable = true;
    const reportingWait = gate();
    const h = await setup({
      source: { before: (op) => { if (op === 'status' && unavailable) throw new AppError(503, 'UNAVAILABLE', 'Unavailable.'); } },
      worker: { delay: async (_ms, signal) => { await Promise.race([reportingWait.promise, new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))]); } },
    });
    try {
      const { jobId } = await acceptance(await h.publish());
      await until(() => !!h.jobs.get(jobId).reportingError);
      expect(h.jobs.get(jobId)).toMatchObject({ status: 'running', step: 'reporting', sourceStatusWritten: false, deliveryOutcome: 'delivered' });
      expect(h.vendor.requests).toHaveLength(1);
      unavailable = false;
      reportingWait.release();
      expect(await h.complete(jobId)).toMatchObject({ status: 'done', sourceStatusWritten: true });
      expect(h.jobs.get(jobId).reportingError).toBeUndefined();
      expect(h.vendor.requests).toHaveLength(1);
    } finally { reportingWait.release(); }
  });

  it('leaves a permanently unreportable job running on shutdown', async () => {
    const h = await setup({
      source: { before: (op) => { if (op === 'status') throw new AppError(400, 'BAD_STATUS', 'Rejected.'); } },
      worker: { delay: async (_ms, signal) => { await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })); } },
    });
    const { jobId } = await acceptance(await h.publish());
    await until(() => !!h.jobs.get(jobId).reportingError);
    await h.worker.drain(5);
    expect(h.jobs.get(jobId)).toMatchObject({ status: 'running', sourceStatusWritten: false });
    expect(h.worker.isAccepting).toBe(false);
    expect((await h.publish('DOC002', 'REQ002')).status).toBe(503);
    expect(await (await h.publish()).json()).toEqual({ jobId });
  });

  it('a reporting HTTP timeout does not release the worker for the next queued job', async () => {
    const statusGate = gate();
    const retryGate = gate();
    const h = await setup({
      timeoutMs: 100,
      source: { before: (operation, documentId) => operation === 'status' && documentId === 'DOC001' ? statusGate.promise : undefined },
      worker: { delay: async (_ms, signal) => {
        signal.throwIfAborted();
        await Promise.race([retryGate.promise, new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))]);
      } },
    });
    try {
      const first = await acceptance(await h.publish());
      await until(() => !!h.jobs.get(first.jobId).reportingError);
      expect(h.jobs.get(first.jobId)).toMatchObject({ status: 'running', step: 'reporting', reportingError: { code: 'SOURCE_NETWORK_ERROR' } });
      const second = await acceptance(await h.publish('DOC002', 'REQ002'));
      expect(h.jobs.get(second.jobId)).toMatchObject({ status: 'running', step: 'queued' });
      expect(h.source.events.some((event) => event.documentId === 'DOC002')).toBe(false);
      statusGate.release();
      retryGate.release();
      expect((await h.complete(first.jobId)).status).toBe('done');
      expect((await h.complete(second.jobId)).status).toBe('done');
      expect(h.vendor.requests.filter((request) => request.delivery.documentId === 'DOC001')).toHaveLength(1);
    } finally { statusGate.release(); retryGate.release(); }
  });
});
