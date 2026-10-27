# Document publishing service technical design

The service publishes documents from a Source system to a Vendor, preserving an archive before removing the Source copy. The implementation uses Node.js and TypeScript, in-memory operational state, and a local archive volume.

## 1 Architecture

```text
Browser → Frontend static server and /api proxy → Publishing API
                                                  ├─ in-process worker
                                                  ├─ archive volume
                                                  ├─ Source API stub
                                                  └─ Vendor API stub
```

Use Express, TypeScript strict mode, native fetch, and Vitest. Zod defines shared runtime schemas and inferred contract types; Pino and Pino HTTP provide structured application and request logs. The frontend uses Vite and vanilla TypeScript. Organize the repository into `publishing-api`, `source-stub`, `vendor-stub`, and `frontend`.

Publication starts through `POST /publish`. The worker runs inside the Publishing API process; no database, message broker, or scheduled Source polling is required.

## 2 Component responsibilities

| Component | Responsibilities |
| --- | --- |
| Publishing API | Authentication, validation, job creation, deduplication, workflow execution, archiving, and status reporting. |
| Source stub | Seed documents; expose metadata and bytes; store archive links and final status; delete original bytes while retaining metadata. |
| Vendor stub | Receive files, fail randomly about 30% of the time, and deduplicate accepted deliveries. |
| Frontend | Login, submit document IDs, display session jobs newest first, poll status, and show waiting states and failure reasons. |

### Frontend behavior

Use separate client-side routes: `/login` for credentials and `/workspace` for publication and job tracking. Initial unauthenticated access, direct workspace navigation, logout, and API `401` responses resolve to `/login`. Successful login opens `/workspace`. The API remains independently protected by bearer authentication. Tokens stay in page memory, so a full refresh requires login again.

Generate one UUID `requestId` per intended submission and reuse it when retrying a lost response. Disable duplicate submission while awaiting `202`. After receiving `jobId`, add or update the corresponding row and fetch its status immediately.

Poll each nonterminal job approximately once per second using the bearer token. Schedule the next request after the previous one finishes, with a timeout to prevent overlapping requests. Display document ID, job ID, creation time, status, current step, and Vendor attempt count. A document conflict (`409` with an existing job ID) opens an error dialog explaining that no new publication was started; retain the existing job and its status. Sort by server `createdAt` descending, using local acceptance time until the first snapshot arrives. Repeated responses must not duplicate or reorder existing jobs.

| State | UI behavior |
| --- | --- |
| Awaiting acceptance | Show “Submitting.” |
| `running` | Show a waiting indicator and current step; continue polling. |
| `done` | Show completion and stop polling. |
| `failed` | Show `error.message` and stop polling. |
| Final status reporting delayed | Keep `running`; show “Waiting to write final status” and `reportingError.message`. |
| Poll timeout, network error, or `5xx` | Preserve the last status, mark it stale, and retry with capped backoff. |
| Poll `401` | Pause polling, request login, then resume without resubmitting jobs. |
| Poll `404` | Show “Job unavailable,” stop polling, and allow manual refresh without automatic republication. |

Keep job IDs in page memory; refreshing loses the list. No `GET /jobs` list endpoint is included. Pause requests on logout and clean up timers and outstanding requests when the page closes.

## 3 API contracts

Bodies use JSON except the form-encoded token request and bodyless `204` responses. Errors use `{error:{code,message}}`. Zod validates requests, upstream contracts, archive metadata, and startup configuration; raw validation issues and input values are not exposed in errors. IDs must match `[A-Za-z0-9_-]{1,128}`. Authenticate protected routes before processing input or creating state. Timestamps use UTC ISO strings.

### Publishing API

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /oauth/token` | Form fields `client_id`, `client_secret`; optional `grant_type=client_credentials` | `200 {access_token, token_type:"Bearer", expires_in:900}`; invalid credentials `401`; malformed form `400`. |
| `POST /publish` | Bearer token; `{documentId, requestId}` | `202 {jobId}` with `Location: /jobs/{jobId}`, including matching duplicates. |
| `GET /jobs/{id}` | Bearer token | `200` job snapshot; unknown ID `404`. |
| `GET /health` | No credentials | `200` when ready; no business data. |

A job snapshot contains:

- `jobId`, `documentId`, `requestId`.
- `status`: `running`, `done`, or `failed`; `step`: current workflow step.
- `createdAt`, `updatedAt`, optional `completedAt`.
- `vendorAttempts`, `deliveryOutcome`: `not_sent`, `delivered`, or `unknown`.
- `sourceStatusWritten`; optional `error` and `reportingError`, each `{code,message}`.

### Source API stub

| Endpoint | Contract |
| --- | --- |
| `GET /documents/{id}` | `200 {id, filename, contentType, contentBase64}`; `404` if missing or bytes were deleted. |
| `PUT /documents/{id}/archive` | `{archiveUri, sha256, sizeBytes}` → `204`; identical updates succeed; conflicting links return `409`. |
| `DELETE /documents/{id}` | Remove bytes and return `204`; require an archive link or return `409`. Repeated deletion of an existing metadata record succeeds. |
| `PUT /documents/{id}/status` | `{jobId, status:"Published"\|"Error", message?}` → `204`; idempotent and valid after deletion. |

Status updates may create a metadata-only record for an unknown document so a failed fetch can still report `Error`. They never recreate document bytes. Limit decoded files to 5 MiB and JSON bodies to 8 MiB.

### Vendor API stub

`POST /deliveries` accepts header `Idempotency-Key: <jobId>` and body `{documentId, filename, contentType, contentBase64, sha256}`.

Check accepted keys first: a matching key and payload returns the original `200 {receiptId}`; a changed payload returns `409`. For a new key, randomly return `500` about 30% of the time before acceptance; otherwise record one receipt and return `200`. Tests use scripted outcomes, including acceptance followed by a lost response.

Both stubs are internal to the Compose network. Test inspection and fault injection remain disabled in the default stack.

## 4 Job lifecycle

```text
queued → fetching → archiving → linking → deleting → delivering → reporting
                                                                    ├→ done
                                                                    └→ failed
```

Accepted jobs have status `running`, including while queued. Execute these steps in order:

1. Fetch document metadata and bytes from Source.
2. Write and verify the archive.
3. Store the archive link in Source.
4. Delete original Source bytes.
5. Deliver archived bytes to Vendor.
6. Write `Published`, or `Error` with a message, to Source.

Any workflow error skips remaining business steps and enters `reporting` with `Error`. Mark `done` or `failed` only after Source acknowledges the final status. Preserve the original failure separately from reporting errors.

If reporting fails, remain `running` and retry. Never repeat Vendor delivery because a final status update failed. A lost Vendor response may leave `deliveryOutcome` as `unknown`.

## 5 Idempotency

Maintain `jobsById`, `jobIdByRequestId`, and `jobIdByDocumentId`. Perform lookup, conflict checks, capacity checks, insertion, and enqueue synchronously without an intervening `await`.

| Request | Behavior |
| --- | --- |
| Same request ID and document ID | Return the original job, regardless of state; never enqueue again. |
| Same request ID, different document ID | `409 REQUEST_ID_CONFLICT`. |
| New request ID, previously accepted document ID | `409 DOCUMENT_ALREADY_SUBMITTED`, including the existing job ID. |
| New work at capacity | `503`; do not reserve IDs. Existing duplicates still resolve. |

Retain mappings for the process lifetime. Document IDs represent immutable documents; automatic republication of failed jobs is excluded. All Vendor attempts use the same job ID and archived payload. Receiver-side deduplication ensures one accepted delivery despite repeated HTTP attempts.

## 6 Background execution

Use a FIFO queue and one asynchronous worker. Return `202` after local acceptance without awaiting workflow execution. Catch worker errors and route them through final reporting.

Apply a 5-second timeout to outbound requests and cap retained jobs at 1,000. On shutdown, stop admissions and allow a bounded drain. A job waiting indefinitely for Source reporting blocks this single worker; queued work remains visible until capacity is reached.

The 5-second timeout applies to each HTTP attempt, not to the job as a whole. There is no overall job deadline. A reporting request that times out is retried and continues to occupy the worker. Allowing later jobs to proceed while reporting remains pending would require separate reporting scheduling; this is excluded from the current implementation.

Inject HTTP clients, archive storage, clock, and delay functions for testing.

Pino logs job steps, upstream retries, reporting retries, and terminal outcomes with job, document, and publication request IDs. Pino HTTP generates a separate transport request ID and logs method, path, response status, and duration. Omit bodies, headers, query strings, and raw errors from HTTP logs; configure redaction for secrets, tokens, and file content. Set verbosity through `LOG_LEVEL`; omit routine health requests.

## 7 Retry strategy

| Operation | Policy |
| --- | --- |
| Vendor delivery | Four total attempts; delays of 250, 500, and 1,000 ms plus jitter. Retry network errors, timeouts, `408`, `429`, and `5xx`. Cap `Retry-After` at five seconds; other `4xx` fail immediately. |
| Source read, archive link, delete | Three total attempts for transient failures; ordinary `4xx` stop the workflow. Writes and deletion must be repeat-safe. |
| Final Source status | Retry transient failures indefinitely with exponential backoff capped at 30 seconds. Persistent contract errors remain visible and retry every 30 seconds. |

Vendor exhaustion reports `Error` and retains the archive. A permanently unavailable Source prevents terminal job status; acknowledgement cannot be guaranteed during an indefinite outage.

## 8 Authentication

Configure one client ID and secret through environment variables. Issue a cryptographically random opaque token stored in memory with client identity and a 15-minute expiry. Token responses use `Cache-Control: no-store`.

Both publication and job lookup require a valid bearer token. Missing, malformed, unknown, or expired tokens return `401` and perform no workflow work.

The login page collects credentials at runtime, clears the secret field after submission, and holds the token only in memory. Do not bundle credentials or persist them in browser storage. Jobs continue when the initiating token expires. User management, refresh tokens, roles, and a full OAuth authorization server are excluded.

## 9 Archive and deletion safety

Store each file at `/archive/<jobId>/document.bin`, independent of source filenames. Write a temporary file on the same volume, sync and close it, atomically rename it, then verify size and SHA-256. Sync the directory where supported. Store filename, content type, size, and hash in a metadata sidecar; reject mismatched existing archives.

Delete Source bytes only after archive verification and acknowledgement of the archive link. Archive or link failures prevent deletion and delivery. Read and verify the archived bytes for Vendor delivery.

Use `archive:/<jobId>/document.bin` as an internal locator. Retain archives on success and failure; no automatic deletion is included. The Docker volume survives container recreation but provides no replication or protection against disk loss or volume deletion.

## 10 State and limitations

| Component | In-memory state |
| --- | --- |
| Publisher | Jobs, request/document indexes, queue, and tokens. |
| Source stub | Seeded bytes, metadata, archive links, and statuses. |
| Vendor stub | Accepted idempotency keys and receipts. |

Run one Publishing API process and replica. Restart loses operational state, deduplication history, tokens, and queued work; stubs reseed fixtures. Archives persist, but automatic recovery and replay are excluded. Release payload buffers after processing; archive disk usage grows without automatic retention.

## 11 Testing

Use Vitest unit tests and HTTP integration tests with isolated temporary archives, deterministic stub failures, and operation counters. Use fake time for retry and polling tests.

| Case | Expected result |
| --- | --- |
| Happy path | Immediate `202`; required operation order; matching archive/delivery hashes; Source bytes removed; `Published` acknowledged before `done`. |
| Duplicate requests | Sequential and concurrent retries return one job during and after processing; one workflow and at most one accepted delivery. |
| Conflicts and capacity | Correct `409`/`503`; rejected requests reserve no IDs. |
| Vendor failures | Scripted `500,500,200` succeeds with correct retries; exhaustion and nonretryable `400` report `Error` before `failed`. |
| Lost Vendor response | Retry returns the original receipt; one accepted delivery. |
| Authentication | Missing, malformed, invalid, and expired tokens return `401` on both protected routes with no work; invalid credentials are rejected. |
| Archive safety | Write, verification, and link failures preserve Source bytes and prevent deletion/delivery. |
| Source failures | Missing document, fetch failure, and delete failure report `Error`; status updates work after byte deletion. |
| Reporting failure | Job stays `running` until acknowledgement; Vendor delivery is not repeated. |
| Frontend | Waiting and error displays, newest-first order, duplicate-row suppression, polling stop/cleanup, no overlapping requests, stale status, `401` resume, and `404` handling. |
| Compose smoke test | Start stack, login, submit a seeded document, and observe terminal status through HTTP. |

Test the random-failure threshold using an injected random function rather than probabilistic assertions. Keep tests independent of internet access and test order.

Provide opt-in Source fixtures for 1 MiB, 5 MiB, oversize, slow operations, and request timeouts. Verify that a 5 MiB payload is archived and delivered intact, and that oversize rejection retains Source bytes. Normal mode uses only the original fixtures. Both standalone manual testing and Compose testing reuse the same Source fixtures and normal application flow.

## 12 Docker Compose

Run four services: `frontend` exposes localhost port 3000; Publishing API, Source stub, and Vendor stub use internal ports 3001–3003. Frontend proxies `/api`; publisher uses Compose service names. Only publisher mounts `archive-data:/archive`.

Provide health checks, readiness dependencies, multi-stage builds, non-root runtime users, and a writable archive directory. Store example configuration in `.env.example` and local credentials in ignored `.env`.

`docker compose up --build` starts the stack. Document seeded IDs and that `docker compose down -v` deletes archives.

`compose.testing.yaml` overrides ports to 4180/4181 and enables Source test fixtures. Run with project name `fineline-testing` to isolate the network, containers, and archive volume from the normal stack. Default testing Vendor failure rate is zero for deterministic size/timing checks; permit an explicit testing failure-rate override. No additional services are needed.

Serve Swagger UI at Publishing API `/docs/` and the OpenAPI contract at `/openapi.json`, including form token issuance, bearer authentication, publish conflicts, asynchronous status semantics, and health. Generate component schemas from Zod. Serve assets locally and keep Swagger authorization in page memory. `API_DOCS_ENABLED=false` disables documentation routes; business endpoint authentication is independent.

## 13 CI

GitHub Actions runs on pushes and pull requests:

1. Install the selected supported Node LTS and dependencies with `npm ci`.
2. Run lint, TypeScript checks, tests, and application builds.
3. Build all four Docker images.
4. Start Compose, wait for health with a deadline, and run the authenticated publication smoke test.
5. Collect failure logs and always tear down test containers and volumes.

No image publishing or deployment is required.

## 14 Design assumptions and production improvements

| Requirement ambiguity | Decision |
| --- | --- |
| Introductory wording suggests delivery before deletion | Follow the explicit numbered workflow: archive, link, delete, then deliver. |
| Status must be written after document deletion | Delete only bytes; retain writable metadata. |
| Only-once delivery during retries | Require Vendor idempotency support; without receiver cooperation, uncertain remote outcomes cannot guarantee exactly-once delivery. |
| Every job must write final status | Require Source acknowledgement before terminal status; outages leave jobs waiting. |
| Multiple request IDs for one document | Treat document IDs as immutable and reject a second submission. |
| Job history scope | Display jobs created in the current page session. |

Production priorities are durable job/idempotency records, persisted workflow checkpoints, crash recovery, independent final-status retries, Vendor reconciliation, version-aware Source mutations, and replicated object storage with retention controls. Add TLS, managed secrets, authorization, rate limits, metrics, and alerts. Use streaming for large files; introduce a durable queue when throughput or recovery requirements justify it.

Excluded from this implementation: databases, message brokers, multiple workers/replicas, manual redrive, global job history, archive download/retention management, user management, and deployment.

The README must include setup instructions, seeded document IDs, design decisions, production limitations, omitted features, and AI tool usage as required by the assignment.
