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
export interface DocumentFile {
  id: string;
  filename: string;
  contentType: string;
  contentBase64: string;
}
export interface ArchiveLink { archiveUri: string; sha256: string; sizeBytes: number }
export interface ArchiveRecord extends ArchiveLink { filename: string; contentType: string }
export interface FinalStatus { jobId: string; status: 'Published' | 'Error'; message?: string }
export interface Delivery {
  documentId: string;
  filename: string;
  contentType: string;
  contentBase64: string;
  sha256: string;
}
