import { randomUUID } from 'node:crypto';
import type { Job } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors.js';

export class JobStore {
  private readonly jobsById = new Map<string, Job>();
  private readonly jobIdByRequestId = new Map<string, string>();
  private readonly jobIdByDocumentId = new Map<string, string>();

  constructor(private readonly capacity = 1000, private readonly now: () => number = Date.now) {}

  accept(documentId: string, requestId: string, accepting = true): { job: Job; created: boolean } {
    const existingId = this.jobIdByRequestId.get(requestId);
    if (existingId) {
      const job = this.get(existingId);
      if (job.documentId !== documentId) throw new AppError(409, 'REQUEST_ID_CONFLICT', 'Request ID belongs to another document.');
      return { job, created: false };
    }
    const documentJob = this.jobIdByDocumentId.get(documentId);
    if (documentJob) throw new AppError(409, 'DOCUMENT_ALREADY_SUBMITTED', 'Document has already been submitted.', documentJob);
    if (!accepting || this.jobsById.size >= this.capacity) throw new AppError(503, 'UNAVAILABLE', 'New publications cannot be accepted.');
    const timestamp = new Date(this.now()).toISOString();
    const job: Job = {
      jobId: randomUUID(), documentId, requestId, status: 'running', step: 'queued',
      createdAt: timestamp, updatedAt: timestamp, vendorAttempts: 0,
      deliveryOutcome: 'not_sent', sourceStatusWritten: false,
    };
    this.jobsById.set(job.jobId, job);
    this.jobIdByRequestId.set(requestId, job.jobId);
    this.jobIdByDocumentId.set(documentId, job.jobId);
    return { job: structuredClone(job), created: true };
  }

  get(jobId: string): Job {
    const job = this.jobsById.get(jobId);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found.');
    return structuredClone(job);
  }

  update(jobId: string, changes: Partial<Pick<Job, 'status' | 'step' | 'completedAt' | 'vendorAttempts' | 'deliveryOutcome' | 'sourceStatusWritten' | 'error' | 'reportingError'>>): void {
    const job = this.jobsById.get(jobId);
    if (!job) throw new Error('Worker referenced an unknown job.');
    Object.assign(job, changes, { updatedAt: new Date(this.now()).toISOString() });
    if (changes.sourceStatusWritten) delete job.reportingError;
  }
}
