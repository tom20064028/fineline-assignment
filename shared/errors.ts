import type { ErrorDetail } from './contracts.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly jobId?: string,
  ) { super(message); }
}

export class RemoteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly uncertain = false,
    public readonly retryAfterMs = 0,
  ) { super(message); }
}

export function errorDetail(error: unknown): ErrorDetail {
  if (error instanceof RemoteError || error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'PROCESSING_FAILED', message: 'Document processing failed.' };
}
