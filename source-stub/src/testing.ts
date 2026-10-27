import type { DocumentFile } from '../../shared/contracts.js';
import { MAX_FILE_BYTES } from '../../shared/schemas.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { SourceOptions } from './app.js';

export function testingDocuments(): DocumentFile[] {
  return [
    ['LARGE_1MB', 1024 * 1024], ['LARGE_5MB', MAX_FILE_BYTES],
    ['TOO_LARGE', MAX_FILE_BYTES + 1],
    ['SLOW001', 128], ['SLOW002', 128], ['SLOW003', 128], ['TIMEOUT001', 128],
  ].map(([id, size]) => ({
    id: String(id), filename: `${id}.bin`, contentType: 'application/octet-stream',
    contentBase64: Buffer.alloc(Number(size), 0x61).toString('base64'),
  }));
}

export function testingBefore(delayMs: number): NonNullable<SourceOptions['before']> {
  return async (operation, documentId) => {
    if (documentId.startsWith('SLOW')) await delay(delayMs);
    if (documentId === 'TIMEOUT001' && operation === 'fetch') await delay(6000);
  };
}
