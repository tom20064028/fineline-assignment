import type { Express } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '../shared/contracts.js';
import { createSourceStub, type SourceOptions } from '../source-stub/src/app.js';
import { createVendorStub, type VendorOptions } from '../vendor-stub/src/app.js';
import { createPublishingApp } from '../publishing-api/src/app.js';
import { LocalArchive, type ArchiveStorage } from '../publishing-api/src/archive.js';
import { TokenService } from '../publishing-api/src/auth.js';
import { sourceClient, vendorClient } from '../publishing-api/src/clients.js';
import { JobStore } from '../publishing-api/src/jobs.js';
import { PublishingWorker, type WorkerOptions } from '../publishing-api/src/worker.js';
import { id, object } from '../shared/validation.js';

export async function acceptance(response: Response): Promise<{ jobId: string }> {
  return { jobId: id(object(await response.json()).jobId) };
}

export async function listen(app: Express) {
  const server: Server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1');
    instance.once('listening', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

export async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error('Condition was not reached.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export interface HarnessOptions {
  source?: SourceOptions;
  vendor?: VendorOptions;
  archive?: (local: LocalArchive) => ArchiveStorage;
  worker?: WorkerOptions;
  capacity?: number;
  now?: () => number;
  timeoutMs?: number;
}

export async function harness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'publishing-test-'));
  const source = createSourceStub(options.source);
  const vendor = createVendorStub({ failureRate: 0, ...options.vendor });
  const sourceServer = await listen(source.app);
  const vendorServer = await listen(vendor.app);
  const local = new LocalArchive(root);
  const jobs = new JobStore(options.capacity, options.now);
  const tokens = new TokenService('test-client', 'test-secret', options.now);
  const waits: number[] = [];
  const worker = new PublishingWorker(jobs, sourceClient(sourceServer.url, options.timeoutMs), vendorClient(vendorServer.url, options.timeoutMs), options.archive?.(local) ?? local, {
    delay: async (ms) => { waits.push(ms); }, random: () => 0, ...options.worker,
  });
  const api = await listen(createPublishingApp(tokens, jobs, worker));
  const token = tokens.issue('test-client', 'test-secret').access_token;
  const request = (path: string, init: RequestInit = {}) => fetch(`${api.url}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  return {
    root, source, vendor, sourceServer, vendorServer, api, local, jobs, worker, waits, tokens, token, request,
    async publish(documentId = 'DOC001', requestId = 'REQ001') {
      return request('/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId, requestId }) });
    },
    async complete(jobId: string): Promise<Job> {
      await until(() => jobs.get(jobId).status !== 'running');
      return jobs.get(jobId);
    },
    async close() {
      worker.stop();
      await worker.idle();
      await Promise.all([api.close(), sourceServer.close(), vendorServer.close()]);
      await rm(root, { recursive: true, force: true });
    },
  };
}
