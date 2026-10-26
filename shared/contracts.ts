import type { z } from 'zod';
import type { archiveLinkSchema, archiveRecordSchema, deliverySchema, documentSchema, finalStatusSchema } from './schemas.js';

export interface ErrorDetail { code: string; message: string }
export type JobStep = 'queued' | 'fetching' | 'archiving' | 'linking' | 'deleting' | 'delivering' | 'reporting';
export interface Job {
  jobId: string;
  documentId: string;
  requestId: string;
  status: 'running' | 'done' | 'failed';
  step: JobStep;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  vendorAttempts: number;
  deliveryOutcome: 'not_sent' | 'delivered' | 'unknown';
  sourceStatusWritten: boolean;
  error?: ErrorDetail;
  reportingError?: ErrorDetail;
}
export type DocumentFile = z.infer<typeof documentSchema>;
export type ArchiveLink = z.infer<typeof archiveLinkSchema>;
export type ArchiveRecord = z.infer<typeof archiveRecordSchema>;
export type FinalStatus = z.infer<typeof finalStatusSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
