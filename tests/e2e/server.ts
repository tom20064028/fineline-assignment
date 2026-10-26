import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { harness } from '../helpers.js';

const root = await mkdtemp(join(tmpdir(), 'frontend-e2e-'));
const h = await harness({
  source: { before: async (operation) => { if (operation === 'fetch') await new Promise((resolve) => setTimeout(resolve, 400)); } },
});
process.env.FRONTEND_API_TARGET = h.api.url;
process.env.FRONTEND_PORT = '4173';
const vite = await createServer({ configFile: 'frontend/vite.config.ts', cacheDir: join(root, 'vite-cache') });
await vite.listen(); vite.printUrls();
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  await vite.close(); await h.close(); await rm(root, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
