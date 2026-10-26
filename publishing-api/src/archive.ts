import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArchiveRecord, DocumentFile } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';
import { decodeFile, hash, id } from '../../shared/validation.js';

export interface ArchiveStorage {
  save(jobId: string, file: DocumentFile): Promise<ArchiveRecord>;
  read(jobId: string, record: ArchiveRecord): Promise<Buffer>;
}

async function durableWrite(path: string, bytes: Buffer | string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || !['EINVAL', 'ENOTSUP'].includes(String(error.code))) throw error;
  } finally { await handle.close(); }
}

export class LocalArchive implements ArchiveStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private directory(jobId: string): string { return join(this.root, id(jobId)); }

  async save(jobId: string, file: DocumentFile): Promise<ArchiveRecord> {
    const bytes = decodeFile(file.contentBase64);
    const record: ArchiveRecord = {
      archiveUri: `archive:/${jobId}/document.bin`, filename: file.filename, contentType: file.contentType,
      sizeBytes: bytes.length, sha256: hash(bytes),
    };
    const directory = this.directory(jobId);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
        const existing: unknown = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Archive conflict.', { cause: error });
        await this.read(jobId, record);
        return record;
      }
      const temporary = join(directory, `.document-${randomUUID()}.tmp`);
      try {
        await durableWrite(temporary, bytes);
        await rename(temporary, join(directory, 'document.bin'));
        await durableWrite(join(directory, 'metadata.json'), JSON.stringify(record));
        await syncDirectory(directory);
        await syncDirectory(this.root);
        await this.read(jobId, record);
        return record;
      } finally { await rm(temporary, { force: true }); }
    } catch { throw new AppError(500, 'ARCHIVE_FAILED', 'Archive could not be safely stored and verified.'); }
  }

  async read(jobId: string, record: ArchiveRecord): Promise<Buffer> {
    try {
      const bytes = await readFile(join(this.directory(jobId), 'document.bin'));
      if (bytes.length !== record.sizeBytes || hash(bytes) !== record.sha256) throw new Error('Archive verification failed.');
      return bytes;
    } catch { throw new AppError(500, 'ARCHIVE_INVALID', 'Archive verification failed.'); }
  }
}
