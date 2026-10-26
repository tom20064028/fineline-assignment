import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
const documentId = process.env.SMOKE_DOCUMENT_ID ?? 'DOC003';
const credentials = new URLSearchParams({
  client_id: process.env.CLIENT_ID ?? '', client_secret: process.env.CLIENT_SECRET ?? '',
});
const request = (path, init = {}) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
const unauthenticated = await request('/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId, requestId: 'unauthorized' }) });
assert.equal(unauthenticated.status, 401);
const login = await request('/oauth/token', { method: 'POST', body: credentials });
assert.equal(login.status, 200, 'Login failed; configure CLIENT_ID and CLIENT_SECRET.');
const { access_token } = await login.json();
const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
const body = JSON.stringify({ documentId, requestId: randomUUID() });
const accepted = await request('/publish', { method: 'POST', headers, body });
assert.equal(accepted.status, 202, 'Use a fresh seeded document or restart the backend stack.');
const { jobId } = await accepted.json();
const duplicate = await request('/publish', { method: 'POST', headers, body });
assert.equal(duplicate.status, 202);
assert.deepEqual(await duplicate.json(), { jobId });
const deadline = Date.now() + 30_000;
let job;
do {
  const response = await request(`/jobs/${jobId}`, { headers });
  assert.equal(response.status, 200);
  job = await response.json();
  if (job.status !== 'running') break;
  await delay(100);
} while (Date.now() < deadline);
assert.equal(job.status, 'done', `Publication did not succeed: ${JSON.stringify(job)}`);
assert.equal(job.sourceStatusWritten, true);
console.info(`Smoke test passed: ${jobId}, ${job.vendorAttempts} Vendor attempt(s).`);
