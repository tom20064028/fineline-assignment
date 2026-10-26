import { afterEach, describe, expect, it } from 'vitest';
import { createSourceStub } from '../source-stub/src/app.js';
import { createVendorStub } from '../vendor-stub/src/app.js';
import { hash } from '../shared/validation.js';
import { listen } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

describe('stub contracts', () => {
  it('rejects deletion without an archive, allows repeated deletion, and preserves metadata', async () => {
    const source = createSourceStub();
    const server = await listen(source.app); cleanups.push(server.close);
    const url = `${server.url}/documents/DOC001`;
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(409);
    const link = { archiveUri: 'archive:/job-1/document.bin', sha256: hash(Buffer.from('Document DOC001\n')), sizeBytes: 16 };
    const update = (body: unknown) => fetch(`${url}/archive`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await update(link)).status).toBe(204);
    expect((await update(link)).status).toBe(204);
    expect((await update({ ...link, sha256: '0'.repeat(64) })).status).toBe(409);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(url)).status).toBe(404);
    expect(source.documents.get('DOC001')?.archive).toEqual(link);
  });

  it('uses the 30 percent threshold and deduplicates before random failure', async () => {
    let random = 0.29;
    const vendor = createVendorStub({ random: () => random });
    const server = await listen(vendor.app); cleanups.push(server.close);
    const bytes = Buffer.from('example');
    const payload = { documentId: 'DOC001', filename: 'example.txt', contentType: 'text/plain', contentBase64: bytes.toString('base64'), sha256: hash(bytes) };
    const deliver = (body: unknown = payload) => fetch(`${server.url}/deliveries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'job-1' }, body: JSON.stringify(body) });
    expect((await deliver()).status).toBe(500);
    expect(vendor.receipts.size).toBe(0);
    random = 0.3;
    const accepted = await deliver();
    expect(accepted.status).toBe(200);
    const receipt = await accepted.json();
    random = 0;
    expect(await (await deliver()).json()).toEqual(receipt);
    expect(vendor.receipts.size).toBe(1);
    expect((await deliver({ ...payload, filename: 'different.txt' })).status).toBe(409);
  });
});
