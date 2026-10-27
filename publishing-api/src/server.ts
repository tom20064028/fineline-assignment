import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { serve } from '../../shared/runtime.js';
import { readPublisherConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { LocalArchive } from './archive.js';
import { TokenService } from './auth.js';
import { sourceClient, vendorClient } from './clients.js';
import { JobStore } from './jobs.js';
import { PublishingWorker } from './worker.js';
import { createPublishingApp } from './app.js';

const config = readPublisherConfig();
const logger = createLogger('publishing-api', undefined, config.LOG_LEVEL);
const archiveDir = resolve(config.ARCHIVE_DIR);
const tokens = new TokenService(config.CLIENT_ID, config.CLIENT_SECRET);
await mkdir(archiveDir, { recursive: true, mode: 0o700 });
const jobs = new JobStore();
const worker = new PublishingWorker(jobs,
  sourceClient(config.SOURCE_URL), vendorClient(config.VENDOR_URL),
  new LocalArchive(archiveDir), { logger });
serve(createPublishingApp(tokens, jobs, worker, logger, { docsEnabled: config.API_DOCS_ENABLED }), config.API_PORT, 'publishing-api', () => worker.drain(), logger);
