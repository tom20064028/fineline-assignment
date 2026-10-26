import { jobSchema, publishResponseSchema, tokenResponseSchema } from '../../shared/schemas.js';
import type { Job } from '../../shared/contracts.js';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly jobId?: string) { super(message); }
}

export interface PublishingApi {
  login(clientId: string, secret: string, signal: AbortSignal): Promise<string>;
  publish(documentId: string, requestId: string, token: string, signal: AbortSignal): Promise<string>;
  job(jobId: string, token: string, signal: AbortSignal): Promise<Job>;
}

export class HttpPublishingApi implements PublishingApi {
  constructor(private readonly base = '/api', private readonly timeoutMs = 5000) {}

  private async request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError(0, 'Unable to reach the publishing service. Please try again.');
    }
    let body: unknown;
    try { body = await response.json(); }
    catch {
      // Keep the HTTP status for authentication and unknown-job handling.
      if (!response.ok) throw new ApiError(response.status, 'The service could not complete this request.');
      throw new ApiError(0, 'The service returned an unreadable response.');
    }
    if (!response.ok) {
      const error = body as { error?: { message?: unknown }; jobId?: unknown } | null;
      const message = typeof error?.error?.message === 'string' ? error.error.message : 'The service could not complete this request.';
      throw new ApiError(response.status, message, typeof error?.jobId === 'string' ? error.jobId : undefined);
    }
    return body;
  }

  async login(clientId: string, secret: string, signal: AbortSignal): Promise<string> {
    const response = await this.request('/oauth/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: secret }) }, signal);
    const parsed = tokenResponseSchema.safeParse(response);
    if (!parsed.success) throw new ApiError(0, 'The service returned an invalid login response.');
    return parsed.data.access_token;
  }

  async publish(documentId: string, requestId: string, token: string, signal: AbortSignal): Promise<string> {
    const response = await this.request('/publish', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, requestId }),
    }, signal);
    const parsed = publishResponseSchema.safeParse(response);
    if (!parsed.success) throw new ApiError(0, 'The service returned an invalid publication response.');
    return parsed.data.jobId;
  }

  async job(jobId: string, token: string, signal: AbortSignal): Promise<Job> {
    const response = await this.request(`/jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${token}` } }, signal);
    const parsed = jobSchema.safeParse(response);
    if (!parsed.success || parsed.data.jobId !== jobId) throw new ApiError(0, 'Unable to read the latest job status.');
    return parsed.data;
  }
}
