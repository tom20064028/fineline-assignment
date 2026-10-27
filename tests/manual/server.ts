import { createServer } from 'vite';
import { z } from 'zod';
import { harness } from '../helpers.js';
import { manualDocuments } from './documents.js';
import { delay as retryDelay } from '../../publishing-api/src/retry.js';
import { join } from 'node:path';
import { testingBefore } from '../../source-stub/src/testing.js';

const config = z.object({
  DEMO_DELAY_MS: z.coerce.number().int().min(0).max(4000).default(2500),
  DEMO_PORT: z.coerce.number().int().min(1024).max(65535).default(4174),
}).parse(process.env);

const h = await harness({
  source: {
    documents: manualDocuments(),
    before: testingBefore(config.DEMO_DELAY_MS),
  },
  worker: { delay: retryDelay },
});
process.env.FRONTEND_API_TARGET = h.api.url;
process.env.FRONTEND_PORT = String(config.DEMO_PORT);
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await vite?.close();
  await h.close();
}
try {
  vite = await createServer({ configFile: 'frontend/vite.config.ts', cacheDir: join(h.root, 'vite-cache') });
  await vite.listen();
} catch (error) {
  await stop();
  throw error;
}
console.info(`Manual test workspace: http://127.0.0.1:${config.DEMO_PORT}/login`);
console.info('Credentials: test-client / test-secret (test fixtures only). Vendor failures disabled.');
console.info(`Documents: LARGE_1MB, LARGE_5MB, TOO_LARGE, SLOW001..SLOW003 (~${config.DEMO_DELAY_MS * 4 / 1000}s each), TIMEOUT001 (~16s then failed).`);
console.info(`Archive directory: ${h.root} (removed on shutdown). Ctrl+C to stop; restart to reset all fixtures.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
