import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { port, serve } from '../../shared/runtime.js';
import { LocalArchive } from './archive.js';
import { TokenService } from './auth.js';
import { sourceClient, vendorClient } from './clients.js';
import { JobStore } from './jobs.js';
import { PublishingWorker } from './worker.js';
import { createPublishingApp } from './app.js';

const archiveDir = resolve(process.env.ARCHIVE_DIR ?? './archive');
const tokens = new TokenService(process.env.CLIENT_ID ?? '', process.env.CLIENT_SECRET ?? '');
await mkdir(archiveDir, { recursive: true, mode: 0o700 });
const jobs = new JobStore();
const worker = new PublishingWorker(jobs,
  sourceClient(process.env.SOURCE_URL ?? 'http://127.0.0.1:3002'),
  vendorClient(process.env.VENDOR_URL ?? 'http://127.0.0.1:3003'),
  new LocalArchive(archiveDir));
serve(createPublishingApp(tokens, jobs, worker), port(process.env.API_PORT, 3001), 'Publishing API', () => worker.drain());
