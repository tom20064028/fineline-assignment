import type { z } from 'zod';
import type { archiveLinkSchema, archiveRecordSchema, deliverySchema, documentSchema, finalStatusSchema, jobSchema, jobStepSchema } from './schemas.js';

export interface ErrorDetail { code: string; message: string }
export type JobStep = z.infer<typeof jobStepSchema>;
export type Job = z.infer<typeof jobSchema>;
export type DocumentFile = z.infer<typeof documentSchema>;
export type ArchiveLink = z.infer<typeof archiveLinkSchema>;
export type ArchiveRecord = z.infer<typeof archiveRecordSchema>;
export type FinalStatus = z.infer<typeof finalStatusSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
