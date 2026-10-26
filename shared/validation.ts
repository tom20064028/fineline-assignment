import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
import type { DocumentFile } from './contracts.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_REQUEST', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 255): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new AppError(400, 'INVALID_REQUEST', `Invalid ${name}.`);
  }
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 'identifier', 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new AppError(400, 'INVALID_REQUEST', 'Invalid identifier.');
  return result;
}
export function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
export function decodeFile(value: unknown): Buffer {
  const base64 = typeof value === 'string' ? value : '';
  if (typeof value !== 'string' || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    throw new AppError(400, 'INVALID_DOCUMENT', 'File exceeds the size limit or is invalid.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== base64) {
    throw new AppError(400, 'INVALID_DOCUMENT', 'Invalid base64 document.');
  }
  return bytes;
}
export function documentFile(value: unknown): DocumentFile {
  const body = object(value);
  const file = { id: id(body.id), filename: text(body.filename, 'filename'), contentType: text(body.contentType, 'contentType'), contentBase64: body.contentBase64 };
  decodeFile(file.contentBase64);
  return { ...file, contentBase64: file.contentBase64 as string };
}
