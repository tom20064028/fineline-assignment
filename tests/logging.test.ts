import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../shared/logger.js';
import { acceptance, harness, until } from './helpers.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

function capturedLogger() {
  const lines: string[] = [];
  const destination = new Writable({ write(chunk, _encoding, callback) { lines.push(String(chunk)); callback(); } });
  const logger = createLogger('captured', destination, 'info');
  return { logger, lines, records: () => lines.flatMap((line) => line.trim().split('\n').map((value) => JSON.parse(value) as Record<string, unknown>)) };
}

describe('structured logging', () => {
  it('correlates accepted jobs, steps, retries, and completion without logging file contents', async () => {
    const capture = capturedLogger();
    const h = await harness({ logger: capture.logger, vendor: { outcomes: [500, 'success'] } }); close = h.close;
    const response = await h.publish();
    expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
    const { jobId } = await acceptance(response);
    await h.complete(jobId);
    const records = capture.records();
    const events = records.filter((record) => record.jobId === jobId);
    expect(events.find((record) => record.event === 'publication_accepted')).toMatchObject({ documentId: 'DOC001', requestId: 'REQ001' });
    expect(events.filter((record) => record.event === 'job_step').map((record) => record.step)).toEqual(['fetching', 'archiving', 'linking', 'deleting', 'delivering', 'reporting']);
    expect(events.find((record) => record.event === 'operation_retry')).toMatchObject({ step: 'delivering', attempt: 1, delayMs: 250 });
    expect(events.find((record) => record.event === 'job_completed')).toMatchObject({ status: 'done', vendorAttempts: 2 });
    const output = capture.lines.join('');
    expect(output).not.toContain(h.token);
    expect(output).not.toContain('Document DOC001');
    expect(output).not.toContain(Buffer.from('Document DOC001\n').toString('base64'));
  });

  it('excludes credentials, tokens, query strings, and malformed JSON bodies from HTTP logs', async () => {
    const capture = capturedLogger();
    const h = await harness({ logger: capture.logger }); close = h.close;
    await fetch(`${h.api.url}/oauth/token?secret=query-secret-value`, {
      method: 'POST', body: new URLSearchParams({ client_id: 'test-client', client_secret: 'test-secret' }),
    });
    const response = await h.request('/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"client_secret":"malformed-json-secret",' });
    expect(response.status).toBe(400);
    await until(() => capture.records().filter((r) => r.req !== undefined).length >= 2);
    const output = capture.lines.join('');
    for (const secret of ['test-secret', 'query-secret-value', 'malformed-json-secret', h.token, 'access_token', 'client_secret']) expect(output).not.toContain(secret);
    const http = capture.records().find((record) => (record.req as { path?: string } | undefined)?.path === '/oauth/token');
    expect(http).toMatchObject({ res: { statusCode: 200 } });
    const count = capture.lines.length;
    await fetch(`${h.api.url}/health`);
    expect(capture.lines).toHaveLength(count);
  });

  it('redacts explicit sensitive fields as a second layer', () => {
    const capture = capturedLogger();
    capture.logger.info({ authorization: 'bearer-secret', client_secret: 'credential-secret', access_token: 'token-secret', contentBase64: 'file-secret', body: { client_secret: 'nested-secret' }, jobId: 'visible-job' });
    const output = capture.lines.join('');
    for (const secret of ['bearer-secret', 'credential-secret', 'token-secret', 'file-secret', 'nested-secret']) expect(output).not.toContain(secret);
    expect(capture.records()[0]).toMatchObject({ jobId: 'visible-job' });
  });

  it('does not serialize raw errors from a failing upstream handler', async () => {
    const capture = capturedLogger();
    const h = await harness({
      logger: capture.logger,
      source: { before: (operation) => { if (operation === 'fetch') throw new Error('raw-server-error-with-private-credentials'); } },
    }); close = h.close;
    const { jobId } = await acceptance(await h.publish());
    expect((await h.complete(jobId)).status).toBe('failed');
    expect(capture.lines.join('')).not.toContain('raw-server-error-with-private-credentials');
    expect(capture.records().some((record) => record.event === 'request_error')).toBe(true);
    expect(capture.records().some((record) => (record.res as { statusCode?: number } | undefined)?.statusCode === 500)).toBe(true);
  });
});
