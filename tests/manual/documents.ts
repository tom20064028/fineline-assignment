import type { DocumentFile } from '../../shared/contracts.js';
import { MAX_FILE_BYTES } from '../../shared/schemas.js';

export function manualDocuments(): DocumentFile[] {
  return [
    ['LARGE_1MB', 1024 * 1024], ['LARGE_5MB', MAX_FILE_BYTES],
    ['TOO_LARGE', MAX_FILE_BYTES + 1],
    ['SLOW001', 128], ['SLOW002', 128], ['SLOW003', 128], ['TIMEOUT001', 128],
  ].map(([id, size]) => ({
    id: String(id), filename: `${id}.bin`, contentType: 'application/octet-stream',
    contentBase64: Buffer.alloc(Number(size), 0x61).toString('base64'),
  }));
}
