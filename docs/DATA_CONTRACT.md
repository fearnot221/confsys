# API and data contracts

## Implemented

Zod schemas in `packages/contracts/src/index.ts` generate JSON Schemas used by Fastify response serialization and OpenAPI 3.1 via `pnpm contract:generate`. `packages/contracts/openapi.json` is committed; contract tests compare exact generated output and exercise Fastify → SDK parsing. Only developer-owned schemas are compiled.

| Endpoint | Response |
|---|---|
| GET `/api/health/live` | 200 `{status:"alive"}` |
| GET `/api/health/ready` | 200 `{status:"ready",dependencies:{postgres:"up",redis:"up",worker:"up"}}` |
| GET `/api/health/ready` when unavailable | 503 `{status:"not_ready",dependencies:{...}}`, each `up` or `down` |
| Undefined route | 404 `{error:{code:"NOT_FOUND",message,requestId}}` |
| Invalid request / unexpected error | 400 `INVALID_REQUEST` / 500 `INTERNAL_ERROR`, same error envelope |

`x-request-id` is generated server-side. No raw stack, SQL, credentials or internal provider response in errors. Readiness is intentionally anonymous; reverse proxy should restrict operational endpoints as deployment needs evolve. Phase 1.1 identity routes below add CSRF-protected mutations; no conference business write route exists.

SDK returns a typed readiness DTO for both 200 and 503. Network errors, invalid schema and unexpected HTTP status reject; UI displays an error with retry. SDK rejects a ready-status/HTTP-code mismatch. Strict contracts reject unexpected fields. OpenAPI contract output is not an externally hosted Swagger UI.

## Change discipline, diagnostics and operations

Schema changes must be delivered as new migrations through the documented runner; do not require maintainers to execute undocumented manual SQL during installation or edit a migration that has already run. Scripted cluster/role provisioning is distinct from application schema migrations. For significant data changes, document compatibility with running API/worker versions, backfill ordering/batching, verification and the recovery or forward-fix path after failure. A checksum mismatch is a problem to investigate, not permission to rewrite the ledger.

New environment variables must have centralized validation in `packages/config`, safe defaults or explicit requiredness, and synchronized `.env.example`, setup/Compose/CI and relevant README/operations guidance. Migration/test-only settings should have explicit validators for their purpose; never log their values on validation failure. Current gaps are recorded in the roadmap, not represented as already fixed.

Maintain a consistent public error envelope, structured log fields and explicit job outcomes. Use stable event/error codes, service/operation, request/event/job ID and attempt where applicable; include tenant identifiers only when needed and access-controlled. Never log request bodies or raw error objects without reviewing their contents: passwords, session/invitation/reset tokens, provider credentials and unnecessary personal/manuscript data are forbidden. Internal diagnostics may distinguish failure categories without exposing them in public DTOs.

Catching an error must preserve its failure semantics (for example, dependency down → 503, rejected job → failed/retryable outcome) and provide safe diagnostic context. Do not turn errors into empty success, assert an invalid payload into a DTO, or silently swallow unexpected failures. A deliberate suppression needs an explained reason and an observable failure path. These are ongoing requirements; the current mixed worker/DB log formats remain a tracked Phase 0 limitation.

## Conventions for later phases — not endpoints yet

- Identifiers: UUID strings. Tenant fields are explicit in private DTOs where needed, but request IDs do not confer authority. Public DTOs whitelist only published data.
- Timestamps: ISO 8601 UTC, plus separately configured IANA conference timezone. Deadline half-open interval `opens_at <= now < closes_at` uses server time.
- Money: integer minor units encoded as decimal strings to avoid JS precision loss, explicit currency; immutable price/receipt snapshots. Final per-endpoint schemas will be reviewed before release.
- Pagination: bounded page size and opaque cursor; deterministic stable sort; filter/scope included in cursor validation. No pagination endpoint yet.
- Mutations: validated idempotency key scoped to actor/conference/operation with DB unique constraints, canonical request hash and replay response; same key/different input must conflict.
- Business, registration, payment, submission, decision, presentation and competition states stay separate. Draft submission is never rejection.
- Schema changes: additive first, regenerate OpenAPI, SDK and runtime validation tests, coordinated core/presentation review. Never expose an ORM row as a response by convenience.
- Published/historical results refer to immutable snapshots/revisions. Private file access reauthorizes both task creation and download.

Synthetic queue contract: `synthetic.ping`, `{nonce: UUID}` → `{nonce, processed:true}`. Unsupported jobs fail and retry according to producer policy. No personal or tenant payload; no external effect. Stable job ID deduplicates while job is retained, not forever. Future durable business deduplication belongs in PostgreSQL, not solely BullMQ.

## Phase 1.1 identity API and data

All schemas, error codes and operation definitions live in `packages/contracts/src/auth.ts`; OpenAPI is regenerated from them. SDK owns credentials/CSRF transport. Anonymous mail requests respond **202 accepted**, meaning a valid request was accepted, not that an account exists or mail was delivered. Active/pending/unknown/disabled outcomes do not expose distinct bodies/statuses.

| Method/path | Input | Result |
|---|---|---|
| GET `/api/auth/csrf` | none | 200 `{csrfToken}` plus signed HttpOnly secret cookie |
| POST `/api/auth/register` | email | 202 accepted; eligible pending user/token/outbox atomically persisted |
| POST `/api/auth/resend` | email | 202 accepted; only pending identity can receive verification |
| POST `/api/auth/forgot` | email | 202 accepted; only active identity can receive reset |
| POST `/api/auth/verify` | token, password | 200 complete; activates pending identity; no auto-login |
| POST `/api/auth/reset` | token, password | 200 complete; replaces credential and revokes all sessions; no auto-login |
| POST `/api/auth/login` | email, password | 200 `{user:{id,email,verified:true}}` and opaque HttpOnly session cookie |
| POST `/api/auth/logout` | `{}` | 200 complete; DB revocation and cookie clearing, safe repeat |
| GET `/api/auth/me` | session cookie | 200 same account projection, or 401 expired/absent session |

Mutation requests require exact configured Origin and `x-csrf-token`. Error envelope remains `{error:{code,message,requestId}}`; messages contain safe stable codes. Auth codes map 400 invalid request/token/weak password, 401 invalid credentials/session expired, 403 CSRF rejected/forbidden, 409 conflict, 413 request too large, 415 unsupported media type, 429 rate limited (Retry-After 900), 503 service unavailable, 500 unexpected internal failure. Unknown routes remain 404. SDK preserves code/status/requestId and rejects malformed DTOs. No raw exception is serialized.

Migration `0002_identity.sql` adds users (global normalized unique email/state/credential version), hashed one-time tokens, hashed sessions, minimal auth audit, notifications and separately restricted encrypted delivery secrets. FK/check constraints enforce identity linkage and allowed states/purposes. Worker eligibility view omits all hashes. Public DTOs expose no DB rows, roles, credential version, internal risks or memberships.

This is an additive upgrade from Phase 0, no user backfill or rewrite of 0001. Stop old app processes, migrate separately, then start matching API/worker. Fresh and isolated Phase 0 upgrade tests preserve checksum/history and existing fixture data. Failed migrations roll back as one transaction. Use a reviewed forward migration to repair; never edit applied SQL/checksums or drop local volumes to recover. Detailed lifetime/cleanup/uncertainty policy: [OPERATIONS](OPERATIONS.md).

Migration `0003_identity_grants.sql` narrows runtime UPDATE privileges to required lifecycle/delivery columns and limits the worker eligibility projection to pending/processing notifications. It is a separate forward migration because 0002 had already been exercised locally; 0001/0002 are not rewritten. Actual-role regression rejects recipient/token reassignment, email edits and expiration/hash rewrites outside the implemented services.
