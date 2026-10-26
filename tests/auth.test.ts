import { afterEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { harness } from './helpers.js';
import { object, text } from '../shared/validation.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

describe('authentication and request validation', () => {
  it('issues short-lived tokens only for valid form credentials', async () => {
    const h = await harness(); close = h.close;
    const login = (body: URLSearchParams) => fetch(`${h.api.url}/oauth/token`, { method: 'POST', body });
    const valid = await login(new URLSearchParams({ client_id: 'test-client', client_secret: 'test-secret', grant_type: 'client_credentials' }));
    expect(valid.status).toBe(200);
    expect(valid.headers.get('cache-control')).toBe('no-store');
    const token = object(await valid.json());
    expect(token).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    const unknown = await fetch(`${h.api.url}/jobs/unknown`, { headers: { Authorization: `Bearer ${text(token.access_token, 'access_token')}` } });
    expect(unknown.status).toBe(404);
    expect((await login(new URLSearchParams({ client_id: 'test-client', client_secret: 'wrong' }))).status).toBe(401);
    expect((await login(new URLSearchParams({ client_id: 'test-client' }))).status).toBe(400);
    expect((await login(new URLSearchParams({ client_id: 'test-client', client_secret: 'test-secret', grant_type: 'password' }))).status).toBe(400);
    expect((await fetch(`${h.api.url}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
  });

  it.each([undefined, 'Bearer invalid', 'Basic abc', `Bearer ${'x'.repeat(43)}`, 'Bearer'])('rejects %s authorization before doing work', async (authorization) => {
    const h = await harness(); close = h.close;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization !== undefined) headers.Authorization = authorization;
    // The malformed body must not turn an anonymous request into 400 or 500.
    const publish = await fetch(`${h.api.url}/publish`, { method: 'POST', headers, body: '{' });
    expect(publish.status).toBe(401);
    expect(publish.headers.get('www-authenticate')).toBe('Bearer');
    expect((await fetch(`${h.api.url}/jobs/unknown`, { headers })).status).toBe(401);
    expect(h.source.events).toHaveLength(0);
    expect(h.vendor.requests).toHaveLength(0);
    expect(await readdir(h.root)).toHaveLength(0);
    // Unauthorized calls did not reserve REQ001.
    const accepted = await h.publish();
    expect(accepted.status).toBe(202);
  });

  it('rejects expired tokens on both routes', async () => {
    let time = 1000;
    const h = await harness({ now: () => time }); close = h.close;
    time += 900_000;
    expect((await h.publish()).status).toBe(401);
    expect((await h.request('/jobs/unknown')).status).toBe(401);
    expect(h.source.events).toHaveLength(0);
  });

  it.each([
    '{}', '{', '[]', '{"documentId":"../DOC001","requestId":"REQ001"}',
    '{"documentId":"DOC001","requestId":3}', '{"documentId":"DOC001","requestId":""}',
  ])('rejects invalid publish body %s without creating work', async (body) => {
    const h = await harness(); close = h.close;
    const response = await h.request('/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error.code');
    expect(h.source.events).toHaveLength(0);
  });

  it('rejects oversized authenticated bodies and exposes health without credentials', async () => {
    const h = await harness(); close = h.close;
    expect((await fetch(`${h.api.url}/health`)).status).toBe(200);
    const response = await h.request('/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'x'.repeat(5000), requestId: 'REQ001' }) });
    expect(response.status).toBe(413);
    expect(h.source.events).toHaveLength(0);
  });
});
