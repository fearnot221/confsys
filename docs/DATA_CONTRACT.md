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
