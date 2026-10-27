import { expect, it } from 'vitest';
import { harness } from './helpers.js';
import { openapi } from '../publishing-api/src/openapi.js';
import { jobSchema, publishRequestSchema } from '../shared/schemas.js';
import { z } from 'zod';

it('serves local Swagger assets and contracts without bypassing API authentication', async () => {
  const h = await harness();
  try {
    const redirect = await fetch(`${h.api.url}/docs`, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('docs/');
    const page = await fetch(`${h.api.url}/docs/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Fineline API docs');
    const init = await fetch(`${h.api.url}/docs/swagger-ui-init.js`);
    expect(await init.text()).toContain('../openapi.json');
    expect((await fetch(`${h.api.url}/docs/swagger-ui-bundle.js`)).status).toBe(200);
    const spec = await fetch(`${h.api.url}/openapi.json`);
    expect(await spec.json()).toEqual(openapi);
    expect(openapi.components.schemas.Job).toEqual(z.toJSONSchema(jobSchema, { target: 'openapi-3.0' }));
    expect(openapi.components.schemas.PublishRequest).toEqual(z.toJSONSchema(publishRequestSchema, { target: 'openapi-3.0' }));
    expect(openapi.paths['/publish'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openapi.paths['/jobs/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
    const unauthorized = await fetch(`${h.api.url}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'DOC001', requestId: 'REQ001' }) });
    expect(unauthorized.status).toBe(401);
    expect(h.source.events).toHaveLength(0);
    expect(JSON.stringify(openapi)).not.toContain('test-secret');
  } finally { await h.close(); }
});

it('can disable both documentation routes while keeping business endpoints available', async () => {
  const h = await harness({ docsEnabled: false });
  try {
    for (const path of ['/docs/', '/openapi.json']) expect((await fetch(`${h.api.url}${path}`)).status).toBe(404);
    expect((await fetch(`${h.api.url}/health`)).status).toBe(200);
    expect((await h.publish()).status).toBe(202);
  } finally { await h.close(); }
});
