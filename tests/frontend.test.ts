import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../shared/contracts.js';
import { ApiError, type PublishingApi } from '../frontend/src/api.js';
import { Workspace } from '../frontend/src/workspace.js';

function snapshot(overrides: Partial<Job> = {}): Job {
  return {
    jobId: 'job-1', documentId: 'DOC001', requestId: 'REQ001', status: 'running', step: 'delivering',
    createdAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z',
    vendorAttempts: 1, deliveryOutcome: 'not_sent', sourceStatusWritten: false, ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const workspaces: Workspace[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.dispose(); vi.useRealTimers(); });

async function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T10:00:00.000Z'));
  const api = {
    login: vi.fn<PublishingApi['login']>().mockResolvedValue('private-token'),
    publish: vi.fn<PublishingApi['publish']>().mockResolvedValue('job-1'),
    job: vi.fn<PublishingApi['job']>().mockResolvedValue(snapshot()),
  };
  const workspace = new Workspace(api, { uuid: () => 'REQ001' }); workspaces.push(workspace);
  await workspace.login('client', 'secret');
  return { api, workspace };
}

describe('frontend session and job polling', () => {
  it('keeps credentials and tokens out of the public UI state', async () => {
    const { api, workspace } = await setup();
    expect(workspace.view.authenticated).toBe(true);
    expect(api.login).toHaveBeenCalledWith('client', 'secret', expect.any(AbortSignal));
    expect(JSON.stringify(workspace.view)).not.toContain('private-token');
    expect(JSON.stringify(workspace.view)).not.toContain('secret');
  });

  it('disables repeated submission while waiting for acceptance', async () => {
    const { api, workspace } = await setup();
    const pending = deferred<string>(); api.publish.mockReturnValue(pending.promise);
    const submission = workspace.publish('DOC001');
    expect(workspace.view.submitting).toBe(true);
    await workspace.publish('DOC001');
    expect(api.publish).toHaveBeenCalledTimes(1);
    pending.resolve('job-1'); await submission;
    expect(workspace.view.submitting).toBe(false);
    expect(workspace.view.jobs).toHaveLength(1);
  });

  it('polls running jobs, then stops after done or failed', async () => {
    const { api, workspace } = await setup();
    api.job.mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot({ status: 'done', sourceStatusWritten: true, deliveryOutcome: 'delivered' }));
    await workspace.publish('DOC001');
    expect(api.job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(workspace.view.jobs[0]?.snapshot?.status).toBe('done');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.job).toHaveBeenCalledTimes(2);
  });

  it('preserves a failed job reason and does not poll it again', async () => {
    const { api, workspace } = await setup();
    api.job.mockResolvedValue(snapshot({ status: 'failed', sourceStatusWritten: true, error: { code: 'VENDOR_HTTP_500', message: 'Vendor API returned 500.' } }));
    await workspace.publish('DOC001');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(workspace.view.jobs[0]?.snapshot?.error?.message).toBe('Vendor API returned 500.');
    expect(api.job).toHaveBeenCalledTimes(1);
  });

  it('never overlaps status requests for the same job', async () => {
    const { api, workspace } = await setup();
    const pending = deferred<Job>(); api.job.mockReturnValue(pending.promise);
    await workspace.publish('DOC001');
    await vi.advanceTimersByTimeAsync(10_000);
    await workspace.refresh('job-1');
    expect(api.job).toHaveBeenCalledTimes(1);
    pending.resolve(snapshot()); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.job).toHaveBeenCalledTimes(2);
  });

  it('shows stale state and retries polling without failing or resubmitting the job', async () => {
    const { api, workspace } = await setup();
    api.job.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new ApiError(503, 'Unavailable')).mockResolvedValue(snapshot());
    await workspace.publish('DOC001');
    await vi.advanceTimersByTimeAsync(1000);
    expect(workspace.view.jobs[0]?.staleMessage).toContain('last known status');
    expect(workspace.view.jobs[0]?.snapshot?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(2000);
    expect(workspace.view.jobs[0]?.staleMessage).toBeUndefined();
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it('pauses after 401, keeps history, and resumes after login without republishing', async () => {
    const { api, workspace } = await setup();
    api.job.mockRejectedValueOnce(new ApiError(401, 'Expired')).mockResolvedValue(snapshot());
    await workspace.publish('DOC001');
    expect(workspace.view.authenticated).toBe(false);
    expect(workspace.view.authMessage).toContain('expired');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.job).toHaveBeenCalledTimes(1);
    await workspace.login('client', 'secret');
    expect(workspace.view.jobs).toHaveLength(1);
    expect(api.job).toHaveBeenCalledTimes(2);
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it('stops on 404 and refreshes only when requested', async () => {
    const { api, workspace } = await setup();
    api.job.mockRejectedValueOnce(new ApiError(404, 'Missing')).mockResolvedValue(snapshot({ status: 'done' }));
    await workspace.publish('DOC001');
    expect(workspace.view.jobs[0]?.unavailable).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.job).toHaveBeenCalledTimes(1);
    await workspace.refresh('job-1');
    expect(workspace.view.jobs[0]?.unavailable).toBe(false);
    expect(workspace.view.jobs[0]?.snapshot?.status).toBe('done');
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it('reuses the request ID and original document after an uncertain submission', async () => {
    const { api, workspace } = await setup();
    api.publish.mockRejectedValueOnce(new ApiError(0, 'Network lost')).mockResolvedValue('job-1');
    await workspace.publish('DOC001');
    expect(workspace.view.uncertainSubmission).toBe(true);
    await workspace.publish('DOC002');
    expect(api.publish.mock.calls.map((call) => call.slice(0, 2))).toEqual([['DOC001', 'REQ001'], ['DOC001', 'REQ001']]);
    expect(workspace.view.uncertainSubmission).toBe(false);
    expect(workspace.view.jobs).toHaveLength(1);
  });

  it('keeps pending request IDs across a publish 401 and reauthentication', async () => {
    const { api, workspace } = await setup();
    api.publish.mockRejectedValueOnce(new ApiError(401, 'Expired')).mockResolvedValue('job-1');
    await workspace.publish('DOC001');
    expect(workspace.view.authenticated).toBe(false);
    await workspace.login('client', 'secret');
    await workspace.publish('DOC001');
    expect(api.publish.mock.calls.map((call) => call[1])).toEqual(['REQ001', 'REQ001']);
  });

  it('upserts duplicate jobs and sorts by creation time rather than submission retries', async () => {
    const { api, workspace } = await setup();
    api.publish.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2').mockRejectedValueOnce(new ApiError(409, 'Already submitted', 'job-1'));
    api.job.mockImplementation(async (jobId) => snapshot({ jobId, documentId: jobId === 'job-1' ? 'DOC001' : 'DOC002', status: 'done', createdAt: jobId === 'job-1' ? '2026-10-26T10:00:00.000Z' : '2026-10-26T11:00:00.000Z' }));
    await workspace.publish('DOC001'); await workspace.publish('DOC002'); await workspace.publish('DOC001');
    expect(workspace.view.jobs.map((entry) => entry.jobId)).toEqual(['job-2', 'job-1']);
    expect(workspace.view.jobs).toHaveLength(2);
    expect(workspace.view.publicationError).toBe(true);
    expect(workspace.view.publicationConflict).toEqual({ documentId: 'DOC001', jobId: 'job-1' });
    expect(workspace.view.jobs.find((entry) => entry.jobId === 'job-1')?.snapshot?.status).toBe('done');
    workspace.dismissPublicationConflict();
    await workspace.refresh('job-1');
    expect(workspace.view.publicationConflict).toBeUndefined();
    expect(workspace.view.jobs).toHaveLength(2);
    api.publish.mockRejectedValueOnce(new ApiError(409, 'Already submitted', 'job-1'));
    await workspace.publish('DOC001');
    expect(workspace.view.publicationConflict).toBeDefined();
    workspace.logout();
    expect(workspace.view.publicationConflict).toBeUndefined();
  });

  it('cleans up timers, aborts in-flight work, and ignores late responses after logout', async () => {
    const { api, workspace } = await setup();
    const pending = deferred<Job>(); api.job.mockReturnValue(pending.promise);
    await workspace.publish('DOC001');
    const signal = api.job.mock.calls[0]![2];
    workspace.logout(); expect(signal.aborted).toBe(true);
    pending.resolve(snapshot({ status: 'done' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(workspace.view.jobs[0]?.snapshot).toBeUndefined();
    expect(api.job).toHaveBeenCalledTimes(1);
    workspace.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('validates document IDs before making an HTTP request', async () => {
    const { api, workspace } = await setup();
    await workspace.publish('../unsafe');
    expect(api.publish).not.toHaveBeenCalled();
    expect(workspace.view.publicationMessage).toContain('document ID');
  });
});
