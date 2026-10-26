import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArchive } from '../publishing-api/src/archive.js';
import { seededDocuments } from '../source-stub/src/app.js';
import { MAX_FILE_BYTES } from '../shared/validation.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('local archive', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'archive-test-')); roots.push(root);
    return { root, archive: new LocalArchive(root), file: seededDocuments()[0]! };
  }

  it('stores a stable verified file and metadata, independent of source filenames', async () => {
    const { root, archive, file } = await setup();
    const record = await archive.save('job-1', { ...file, filename: '../../outside.txt' });
    expect(record.archiveUri).toBe('archive:/job-1/document.bin');
    expect(await archive.read('job-1', record)).toEqual(Buffer.from(file.contentBase64, 'base64'));
    expect(JSON.parse(await readFile(join(root, 'job-1', 'metadata.json'), 'utf8'))).toEqual(record);
    expect(await archive.save('job-1', { ...file, filename: '../../outside.txt' })).toEqual(record);
  });

  it('never overwrites a mismatched archive', async () => {
    const { archive, file } = await setup();
    const record = await archive.save('job-1', file);
    await expect(archive.save('job-1', { ...file, contentBase64: Buffer.from('changed').toString('base64') })).rejects.toMatchObject({ code: 'ARCHIVE_FAILED' });
    expect(await archive.read('job-1', record)).toEqual(Buffer.from(file.contentBase64, 'base64'));
  });

  it('detects on-disk corruption', async () => {
    const { root, archive, file } = await setup();
    const record = await archive.save('job-1', file);
    await writeFile(join(root, 'job-1', 'document.bin'), 'corrupted');
    await expect(archive.read('job-1', record)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  });

  it('rejects path traversal, invalid base64, and oversized files', async () => {
    const { archive, file } = await setup();
    await expect(archive.save('../escape', file)).rejects.toThrow();
    await expect(archive.save('job-1', { ...file, contentBase64: '%%%invalid' })).rejects.toThrow();
    await expect(archive.save('job-1', { ...file, contentBase64: Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64') })).rejects.toThrow();
  });
});
