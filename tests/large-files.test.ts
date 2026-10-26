import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acceptance, harness } from './helpers.js';
import { manualDocuments } from './manual/documents.js';
import { MAX_FILE_BYTES } from '../shared/schemas.js';

it('delivers a 5 MiB document intact and rejects an oversized document before deletion', async () => {
  const h = await harness({ source: { documents: manualDocuments() } });
  try {
    const { jobId } = await acceptance(await h.publish('LARGE_5MB', 'large-request'));
    expect((await h.complete(jobId)).status).toBe('done');
    const archived = await readFile(join(h.root, jobId, 'document.bin'));
    expect(archived.equals(Buffer.alloc(MAX_FILE_BYTES, 0x61))).toBe(true);
    const delivered = h.vendor.receipts.get(jobId)?.delivery;
    expect(Buffer.from(delivered!.contentBase64, 'base64').equals(archived)).toBe(true);
    expect(h.source.documents.get('LARGE_5MB')?.file).toBeUndefined();

    const oversized = await acceptance(await h.publish('TOO_LARGE', 'oversized-request'));
    const failed = await h.complete(oversized.jobId);
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('SOURCE_INVALID_DOCUMENT');
    expect(failed.sourceStatusWritten).toBe(true);
    expect(h.source.documents.get('TOO_LARGE')?.file).toBeDefined();
    expect(h.source.documents.get('TOO_LARGE')?.archive).toBeUndefined();
    expect(h.vendor.receipts.has(oversized.jobId)).toBe(false);
  } finally { await h.close(); }
});
