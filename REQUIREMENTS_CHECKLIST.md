# Assignment requirements checklist

Reviewed on 2026-10-27 against `take-home-task-publishing-service.docx` and commit `a42ecc0`.

**Result:** no clear missing mandatory implementation requirement found within the documented single-process, in-memory scope. The qualifications below remain important; passing the checklist does not establish recovery across crashes or restarts.

## API and background workflow

- [x] Use a preferred language: Node.js with TypeScript.
- [x] `POST /publish` accepts `{documentId, requestId}` and returns `202` with a job ID without waiting for Source processing. A gated Source test proves acceptance is independent of completion.
- [x] Run publication in the background; API requests remain available while asynchronous job operations wait.
- [x] `GET /jobs/{id}` returns current job state.
- [x] Read document metadata and bytes from Source over HTTP.
- [x] Write a physical archive under the stable `/archive/<jobId>/document.bin` path, with metadata and checksum.
- [x] Record the archive location in Source before deletion.
- [x] Delete Source file bytes; retain metadata so status can still be updated.
- [x] Deliver archived bytes to Vendor after Source deletion.
- [x] Write final `Published` or `Error` with a message back to Source.
- [x] Preserve the numbered workflow order. The happy-path test checks `fetch → link → delete → deliver → status`, with actual archive/delivery bytes checked separately.

Evidence: [API routes](publishing-api/src/app.ts), [worker](publishing-api/src/worker.ts), [archive](publishing-api/src/archive.ts), [HTTP workflow tests](tests/publishing.test.ts).

## Reliability rules

- [x] Vendor fails randomly about 30% by default; an injected random value verifies the threshold without flaky statistical assertions.
- [x] Handle temporary Vendor failures with retries; exhaustion and nonretryable failures report `Error`.
- [x] Sequential/concurrent duplicate request IDs return the same job, during and after processing.
- [x] Duplicate requests do not create another workflow or accepted Vendor delivery. A lost acceptance response is retried with the same Vendor key and returns its original receipt.
- [x] Prevent Source deletion when archive storage, verification, or archive-link acknowledgement fails; recheck the archive immediately before deletion.
- [x] Do not mark jobs `done` or `failed` until Source acknowledges final status. Reporting failures leave the job `running`; retries do not repeat delivery.

Evidence: [retry tests](tests/retry.test.ts), [workflow/failure tests](tests/publishing.test.ts), [archive tests](tests/archive.test.ts), [stub tests](tests/stubs.test.ts).

## Authentication

- [x] `POST /oauth/token` accepts form-encoded client ID/secret and issues a short-lived token (900 seconds).
- [x] Both publication and job-status endpoints require an Authorization bearer token.
- [x] Missing, malformed, invalid and expired tokens return `401`, not `500`.
- [x] Rejected unauthenticated requests perform no Source, archive or Vendor work and reserve no request ID. Authentication precedes JSON parsing.
- [x] Include explicit automated tests proving unauthenticated rejection.

Evidence: [token service](publishing-api/src/auth.ts), [authentication tests](tests/auth.test.ts).

## Frontend

- [x] Separate static frontend talks to the API over HTTP; it is not rendered by the Publishing API.
- [x] Login exchanges client credentials for a token and uses it for protected calls.
- [x] Document ID input and publish button start a publication.
- [x] Show `running`, `done` and `failed` jobs, newest first.
- [x] Show failure reasons and waiting/processing states; poll until terminal status.

Evidence: [frontend HTTP client](frontend/src/api.ts), [state/polling](frontend/src/workspace.ts), [UI](frontend/src/main.ts), [controller tests](tests/frontend.test.ts), [browser tests](tests/e2e/workspace.spec.ts).

## Stubs, Docker and CI

- [x] Include a Source stub supporting document retrieval, archive-link/status updates and deletion.
- [x] Include a Vendor stub accepting files and applying random failures.
- [x] One Compose command starts frontend, publisher and both stubs; archive storage is a Docker volume.
- [x] CI installs dependencies from the lockfile, runs tests and builds all four Docker images. No deployment is required.
- [x] Include tests for caller retries/idempotency, Vendor retry/failure handling and rejected unauthenticated calls.

Evidence: [Source](source-stub/src/app.ts), [Vendor](vendor-stub/src/app.ts), [Dockerfile](Dockerfile), [Compose](compose.yaml), [GitHub Actions](.github/workflows/ci.yml).

## Repository and README

- [x] Repository contains the service, stubs, frontend, Compose configuration, CI and tests.
- [x] README explains how to run the system and tests.
- [x] README explains implementation decisions and tradeoffs.
- [x] README identifies production improvements and knowingly omitted features.
- [x] README identifies AI assistance and its uses.
- [x] No required database, real deployment or user-management system has been introduced.

Evidence: [README](README.md), [technical design](TECHNICAL_DESIGN.md), [repository](https://github.com/tom20064028/fineline-assignment).

## Verification performed

| Check | Result |
| --- | --- |
| `npm run check` | Passed: lint, TypeScript, 71 unit/integration tests, backend/frontend builds. |
| Fresh isolated `docker compose up --build -d --wait` | Passed: all four services built and healthy. |
| API smoke against Docker | Passed: unauthorized rejection, matching duplicate job, successful publication and final acknowledgement. |
| Browser tests against Docker frontend | Passed: 3 tests covering login, publication, sorting, duplicate popup, session handling, waiting/failure and mobile layout. |
| OpenAPI and proxied Swagger endpoints | Passed. |
| GitHub-hosted CI for `a42ecc0` | [Completed successfully](https://github.com/tom20064028/fineline-assignment/actions/runs/40473848470). |

Docker verification used a disposable project on ports 4190/4191; its containers/volume were removed afterward. Existing demo services and archives were not reset.

## Qualifications and requirement interpretations

1. **Restart scope:** jobs, request indexes and Vendor receipts are in memory. Duplicate-delivery prevention and pending-report recovery do not survive process state loss. The assignment does not specify restart/multi-instance recovery, but its absolute reliability wording makes this an assumption worth explaining. Archives persist; automatic recovery does not.
2. **Final reporting outage:** a job stays nonterminal and blocks the worker until Source acknowledges. This satisfies the implemented final-status gate but provides no guaranteed completion time or recovery after process loss.
3. **Job-list scope:** the frontend shows jobs submitted/recovered in the current page session. Global history and persistence after refresh are not specified and are documented omissions.
4. **Document-level conflicts:** rejecting a new request ID for an already submitted document, including failed jobs, is stricter than the stated request-ID deduplication requirement. It is an explicit immutable-document assumption, not an assignment requirement.
5. **Authentication scope:** the two business endpoints are protected. Token issuance, health and documentation are public; stub services have no host ports in Compose. Documentation can be disabled.
6. **Operational limits:** the 5 MiB file limit, 1,000 retained-job cap and single worker are implementation limits, not limits specified by the assignment.

No upload UI, manual slow-job environment, real-file import feature, database or deployment is required. Removing those extras does not remove a stated requirement; waiting, byte integrity and failure paths remain covered by automated tests.

The stated one-working-day estimate and five-day return deadline concern delivery logistics. Whether the repository has been sent through the agreed channel within that deadline must be confirmed separately.
