import { z } from 'zod';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const filenameSchema = z.string().min(1).max(255);
const contentTypeSchema = z.string().min(1).max(255);
const contentSchema = z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const publishRequestSchema = z.object({ documentId: identifierSchema, requestId: identifierSchema });
export const tokenRequestSchema = z.object({
  client_id: z.string().min(1).max(255),
  client_secret: z.string().min(1).max(1024),
  grant_type: z.literal('client_credentials').optional(),
});
export const documentSchema = z.object({
  id: identifierSchema, filename: filenameSchema, contentType: contentTypeSchema, contentBase64: contentSchema,
});
export const archiveLinkSchema = z.object({
  archiveUri: z.string().max(255).regex(/^archive:\/[A-Za-z0-9_-]+\/document\.bin$/),
  sha256: sha256Schema,
  sizeBytes: z.number().int().min(0).max(MAX_FILE_BYTES),
});
export const archiveRecordSchema = archiveLinkSchema.extend({ filename: filenameSchema, contentType: contentTypeSchema });
export const finalStatusSchema = z.discriminatedUnion('status', [
  z.object({ jobId: identifierSchema, status: z.literal('Published'), message: z.string().min(1).max(1024).optional() }),
  z.object({ jobId: identifierSchema, status: z.literal('Error'), message: z.string().min(1).max(1024) }),
]);
export const deliverySchema = z.object({
  documentId: identifierSchema, filename: filenameSchema, contentType: contentTypeSchema,
  contentBase64: contentSchema, sha256: sha256Schema,
});
export const receiptSchema = z.object({ receiptId: z.string().min(1).max(255) });
export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
