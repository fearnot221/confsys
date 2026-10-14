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

`x-request-id` is generated server-side. No raw stack, SQL, credentials or internal provider response in errors. Readiness is intentionally anonymous; reverse proxy should restrict operational endpoints as deployment needs evolve. No login/CSRF or business write route exists.

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
