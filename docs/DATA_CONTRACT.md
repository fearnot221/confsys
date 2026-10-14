# API and data contracts

## Implemented

Zod schemas in `packages/contracts/src/index.ts` generate JSON Schemas used by Fastify response serialization and OpenAPI 3.1 via `pnpm contract:generate`. `packages/contracts/openapi.json` is committed; contract tests compare exact generated output and exercise Fastify → SDK parsing. Only developer-owned schemas are compiled.

| Endpoint | Response |
|---|---|
| GET `/api/instance` | 200 `{conferenceName:string}`; runtime display only, no secrets or server env |
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

Maintain a consistent public error envelope, structured log fields and explicit job outcomes. Use stable event/error codes, service/operation, request/event/job ID and attempt where applicable; include local actor/resource identifiers only when needed and access-controlled. Never log request bodies or raw error objects without reviewing their contents: passwords, session/invitation/reset tokens, provider credentials and unnecessary personal/manuscript data are forbidden. Internal diagnostics may distinguish failure categories without exposing them in public DTOs.

Catching an error must preserve its failure semantics (for example, dependency down → 503, rejected job → failed/retryable outcome) and provide safe diagnostic context. Do not turn errors into empty success, assert an invalid payload into a DTO, or silently swallow unexpected failures. A deliberate suppression needs an explained reason and an observable failure path. These are ongoing requirements; safe structured logging was added in Phase 1.1; metrics/alerts remain tracked deployment work.

## Conventions for later phases — not endpoints yet

- Identifiers: UUID strings. Resource relationships are explicit where needed, but supplied IDs do not confer authority or select a database. Public DTOs whitelist only published data.
- Timestamps: ISO 8601 UTC, plus separately configured IANA conference timezone. Deadline half-open interval `opens_at <= now < closes_at` uses server time.
- Money: integer minor units encoded as decimal strings to avoid JS precision loss, explicit currency; immutable price/receipt snapshots. Final per-endpoint schemas will be reviewed before release.
- Pagination: bounded page size and opaque cursor; deterministic stable sort; filter/scope included in cursor validation. Phase 1.2 uses bounded offsets as recorded in ADR 0004; opaque cursors remain a convention for future high-volume endpoints.
- Mutations: validated idempotency key scoped to local actor/operation with DB unique constraints, canonical request hash and replay response; same key/different input must conflict.
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

Migration `0002_identity.sql` adds users (instance-local normalized unique email/state/credential version), hashed one-time tokens, hashed sessions, minimal auth audit, notifications and separately restricted encrypted delivery secrets. FK/check constraints enforce identity linkage and allowed states/purposes. Worker eligibility view omits all hashes. Phase 1.1 DTOs exposed no roles; Phase 1.2 adds explicit current role/permission keys below. No DTO exposes DB rows, credential versions, internal risks or memberships.

This is an additive upgrade from Phase 0, no user backfill or rewrite of 0001. Stop old app processes, migrate separately, then start matching API/worker. Fresh and isolated Phase 0 upgrade tests preserve checksum/history and existing fixture data. Failed migrations roll back as one transaction. Use a reviewed forward migration to repair; never edit applied SQL/checksums or drop local volumes to recover. Detailed lifetime/cleanup/uncertainty policy: [OPERATIONS](OPERATIONS.md).

Migration `0003_identity_grants.sql` narrows runtime UPDATE privileges to required lifecycle/delivery columns and limits the worker eligibility projection to pending/processing notifications. It is a separate forward migration because 0002 had already been exercised locally; 0001/0002 are not rewritten. Actual-role regression rejects recipient/token reassignment, email edits and expiration/hash rewrites outside the implemented services.

Phase 1.1b needs no schema migration: 0001–0003 and their checksums are unchanged. Global-identity wording in applied 0002 is historical; the schema already stores one independent account namespace per DB. Existing accounts, hashes, audit/outbox and sessions remain compatible. No table receives an artificial conference ID.

## Phase 1.2 contracts

| Endpoint | Contract / permission |
|---|---|
| GET `/api/auth/me`, POST `/api/auth/login` | Own user includes `roles` and `permissions` arrays from fixed registry; existing ID/email/verified retained |
| POST `/api/auth/reauthenticate` | Strict `{password}`, existing CSRF/Origin/rate limits, `{status:"complete"}`; session-bound server proof |
| GET `/api/access/accounts` | directory.read; search (literal email substring, max 100), state, offset (0–100000), limit (1–50, default 20); stable email/id order |
| GET `/api/access/accounts/:id` | directory.read; UUID; explicit ID/email/state/verified/roles |
| GET `/api/access/roles` | directory.read; fixed role/permission catalog |
| POST `/api/access/accounts/:id/actions` | Strict discriminated `{action,reason,role?}`; grant/revoke require role; disable/restore/revoke_sessions forbid it; appropriate permission + recent proof |
| GET `/api/access/audit` | security_audit.read; bounded offset/limit, descending timestamp/id; safe explicit event projection |

Pages return `{items,nextOffset}`; pagination is not a frozen snapshot. Mutation returns `{changed:boolean}`. All fields are whitelisted; unsupported generic PATCH/profile editing endpoints do not exist. Unknown IDs are 404 only after authorization; unauthenticated is 401, unauthorized 403, malformed input 400. `REAUTH_REQUIRED` is 403; `SELF_CHANGE`, `LAST_ADMIN`, `CONFLICT`, `BOOTSTRAP_COMPLETED` are 409. `SESSION_EXPIRED` invalidates UI private state. All private responses remain no-store; generated OpenAPI includes routes/errors/headers/input/output schemas.

Audit projection contains event ID/action, targetId/actorId (nullable), source, reason (nullable), bounded before/after strings of state/roles, server timestamp and requestId. Existing auth events have source authentication and nullable added fields. No raw DB payload, credential/session/token identifier, secret, IP/email dump or export endpoint. Audit data is append-only to runtime roles; migrations/operator ownership remains trusted.

0004 adds composite primary key `user_roles(user_id,role)`, a one-row persistent bootstrap marker, session `password_verified_at`, and audit actor/source/reason/before/after plus pagination index. FKs/checks enforce supported roles/references/marker pairing; no organization/conference columns, no inferred admin, no credential hash rewrite or forced global logout. Old sessions have NULL proof and must reauthenticate for management. Applied 0001–0003 remain unchanged. Upgrade test covers prior schema records including password hash/verified status/tokens/session/outbox/encrypted-envelope fixture/audit. Full production backup restore and downgrade remain unverified.
