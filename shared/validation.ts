import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { DocumentFile } from './contracts.js';
import { MAX_FILE_BYTES, documentSchema, identifierSchema } from './schemas.js';

export { MAX_FILE_BYTES } from './schemas.js';

export function parse<T extends z.ZodType>(schema: T, value: unknown, code = 'INVALID_REQUEST', message = 'Invalid request.'): z.output<T> {
  const result = schema.safeParse(value);
  // Do not include raw Zod issues: input can contain credentials or file bytes.
  if (!result.success) throw new AppError(400, code, message);
  return result.data;
}

export function object(value: unknown): Record<string, unknown> {
  return parse(z.record(z.string(), z.unknown()), value, 'INVALID_REQUEST', 'Expected an object.');
}
export function text(value: unknown, name: string, max = 255): string {
  return parse(z.string().min(1).max(max), value, 'INVALID_REQUEST', `Invalid ${name}.`);
}
export function id(value: unknown): string {
  return parse(identifierSchema, value, 'INVALID_REQUEST', 'Invalid identifier.');
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
  const file = parse(documentSchema, value, 'INVALID_DOCUMENT', 'Invalid document.');
  decodeFile(file.contentBase64);
  return file;
}
