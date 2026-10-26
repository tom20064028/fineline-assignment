# Document publishing service

Phase one implements the Publishing API, background workflow, local archive, and standalone Source/Vendor stubs. The frontend is reserved for phase two. Architecture and contracts are defined in [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md).

## Structure

```text
publishing-api/src/  routes, tokens, jobs, worker, retry, clients, archive
source-stub/src/     seeded Source HTTP service
vendor-stub/src/     Vendor HTTP service with failures and deduplication
shared/             contracts, validation, HTTP errors, process lifecycle
tests/              HTTP integration and unit tests
scripts/smoke.mjs   authenticated stack smoke test
frontend/           phase two placeholder
.github/workflows/  backend CI
```

## Run with Docker

Requires Docker Compose v2. Copy the example configuration, then start the backend:

```sh
cp .env.example .env
docker compose up --build
```

Publishing API: `http://localhost:3001`. Stubs are accessible only inside Compose. The Source starts with `DOC001`, `DOC002`, and `DOC003`, each a small text file. Each document can be published once per process lifetime.

In another terminal, with Node.js 24 available:

```sh
npm run smoke
```

The smoke test publishes `DOC003`, verifies unauthenticated rejection, duplicate request handling, and successful completion. Set `VENDOR_FAILURE_RATE=0` for a deterministic smoke run; the normal default is `0.3`. A random run can legitimately exhaust all four attempts. Restart stubs and API together to reset in-memory state before repeating the smoke test.

Archives live in the `archive-data` named volume. `docker compose down` preserves them; **`docker compose down -v` deletes them**.

## Local development

Requires Node.js 24 and npm. No global TypeScript installation is needed.

```sh
cp .env.example .env
npm ci
```

Run these in three separate terminals from the repository root:

```sh
npm run dev:source
npm run dev:vendor
npm run dev:api
```

The development entry points load `.env`. Local archives use `./archive`, which is ignored by Git. To run compiled code, use `npm run build`, then `npm run start:source`, `npm run start:vendor`, and `npm run start:api` in separate terminals.

## HTTP walkthrough

The following examples use the credentials from `.env.example`. Change them if you edited `.env`.

```sh
curl -s http://localhost:3001/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=demo-client' \
  --data-urlencode 'client_secret=change-me-for-local-demo'
```

Copy `access_token` from the response into the commands below:

```sh
curl -i http://localhost:3001/publish \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"documentId":"DOC001","requestId":"REQ001"}'

curl -s http://localhost:3001/jobs/<jobId> \
  -H 'Authorization: Bearer <access_token>'
```

Publication returns `202 {jobId}` immediately. Poll the job until `done` or `failed`. Repeating the same request returns the same job. Another document with that request ID returns `409`; another request ID for an already submitted document also returns `409` and its existing job ID. A failed job is retained and is not automatically restarted.

## Workflow and failure handling

The worker fetches Source bytes, writes and verifies the archive, records the archive link, deletes Source bytes, delivers the archived file, then writes `Published` or `Error` to Source. Metadata remains writable after byte deletion. A missing document receives an Error metadata record.

Vendor retries use four total attempts, exponential backoff, jitter, and one stable idempotency key. The Vendor checks previously accepted keys before applying random failure, so a lost acceptance response cannot create a second receipt. Source operations use three transient attempts. Final status writes retry indefinitely: the job stays `running` at `reporting` until Source acknowledges. This can block the single worker. A final-status error never triggers another Vendor delivery.

Archive writes use temporary files, file sync, atomic rename, metadata, and size/SHA-256 verification. Source deletion requires successful archive storage and link acknowledgement. Archives are kept for both successful and failed jobs.

Tokens are opaque, expire after 15 minutes, and remain in memory. Protected endpoints authenticate before parsing request bodies. Logs and public errors omit credentials and upstream bodies. Health checks return no business data.

## Verification

```sh
npm run check
```

Runs lint, strict type checking, tests, and compilation. Tests start real HTTP stub servers on temporary ports and use isolated archive folders. Faults, clocks, random values, and delays are injected in-process; no public reset or fault-injection routes are exposed.

GitHub Actions runs those checks, builds the three backend Docker images, starts Compose, and runs the deterministic smoke test. Frontend checks and its Docker image will be added in phase two.

## Limitations and production changes

State is process-local. Restart loses jobs, request indexes, tokens, Source metadata, and Vendor receipts. Run one API process/replica and restart the demo stack as a unit. Archives survive normal container recreation, but no recovery/replay is implemented. A local volume has no replication or disaster protection. Retained jobs are capped at 1,000; disk archives have no automatic retention. Files are base64 encoded with a 5 MiB decoded limit.

Document IDs are treated as immutable. Global job history, manual redrive, user management, full OAuth compliance, archive retrieval/retention endpoints, and deployment are omitted. Frontend login and job polling are deferred to phase two.

Production priorities: durable jobs/idempotency and checkpoints, crash recovery, independent reporting retries, receiver reconciliation, version-aware Source operations, replicated object storage, streaming, TLS, managed secrets, authorization, rate limiting, and monitoring.

## AI assistance

OpenAI Codex was used to review the assignment, prepare the technical design, implement the phase-one backend and stubs, and write and run verification tests. No other agents were used.
