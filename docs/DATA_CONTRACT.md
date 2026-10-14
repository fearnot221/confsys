# API and data contracts

## Implemented

Zod schemas in `packages/contracts/src/index.ts` generate JSON Schemas used by Fastify response serialization and OpenAPI 3.1 via `pnpm contract:generate`. `packages/contracts/openapi.json` is committed; contract tests compare exact generated output and exercise Fastify → SDK parsing. Only developer-owned schemas are compiled.

| Endpoint | Response |
|---|---|
| GET `/api/instance` | 200 `{conferenceName:string}`; effective official/bootstrap identity, no secrets or server env |
| GET `/api/health/live` | 200 `{status:"alive"}` |
| GET `/api/health/ready` | 200 `{status:"ready",dependencies:{postgres:"up",redis:"up",worker:"up"}}` |
| GET `/api/health/ready` when unavailable | 503 `{status:"not_ready",dependencies:{...}}`, each `up` or `down` |
| Undefined route | 404 `{error:{code:"NOT_FOUND",message,requestId}}` |
| Invalid request / unexpected error | 400 `INVALID_REQUEST` / 500 `INTERNAL_ERROR`, same error envelope |

`x-request-id` is generated server-side. No raw stack, SQL, credentials or internal provider response in errors. Readiness is intentionally anonymous; reverse proxy should restrict operational endpoints as deployment needs evolve. Phase 1.1 identity routes below add CSRF-protected mutations; site write contracts appear below.

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

## Phase 1.3 site contracts

| Method/path | Input and result |
|---|---|
| GET `/api/site` | `{publicationId,conferenceName,document}`; one official immutable document (disabled-language text omitted), or null document before publication |
| GET `/api/instance` | Existing `{conferenceName}` DTO, now through effective official brand resolver; 503 on DB failure |
| GET `/api/site/draft` | read permission; `{draftVersion,document,activePublicationId,publishedDraftVersion}`; version 0 seeds an unpersisted form from bootstrap name |
| POST `/api/site/draft` | write permission; strict `{expectedVersion,document}`; atomic save/audit → new draft DTO |
| GET `/api/site/preview?version=N` | read permission; exact current saved version only; stale version conflicts |
| POST `/api/site/publish` | publish permission + recent password proof; strict `{expectedVersion}`; `{publicationId,draftVersion,publishedAt,publishedBy,changedFields}` |
| GET `/api/site/history?offset=N` | read permission; max offset 100000, fixed 20 per page, descending publishedAt/id, `{items,nextOffset}` |
| POST `/api/site/restore` | write permission; strict `{expectedVersion,publicationId}`; new draft DTO, public pointer unchanged |

No arbitrary PATCH, deployment setting assignment or history deletion. `CONFLICT` 409 means reload/compare before retry; save never silently overwrites. Structural/semantic validation is server-side; SDK/hook provides field-path feedback. Site write body limit 128 KiB; auth retains 16 KiB. Text lengths, arrays and locale/page keys are bounded. Dates are exact YYYY-MM-DD, IANA timezone, start ≤ end. HTTPS/enum internal links only; no HTML engine. Every enabled language needs name plus all four metadata title/descriptions to publish. Other missing text/list/link fields fall back to default-language fields with actual lang attributes.

0005 adds `site_state` (singleton, draft version/document, active publication FK) and `site_publications` (UUID, unique source draft version, immutable document, actor FK/time/changed-field summary). Publication and minimal auth_audit row commit together. `notifications.conference_name` is nullable only for preserved legacy jobs, immutable to runtime update grants; all new identity notifications capture effective official name. No change to credentials/epoch/bootstrap or canonical URL/provider identity. Applied 0001–0004 stay unchanged. See OPERATIONS for upgrade/recovery policy.

## Local role invitations

`invitations/service.ts` is the transaction/authorization owner; its repository persists bounded projections and encrypted links into the existing notification outbox. Creation requires `access.roles.manage`, recent password proof, an existing active verified local recipient, a reason and an issuer-scoped UUID idempotency key. Retrying the same payload returns the existing invitation; reusing its key for different input conflicts. The invitation never creates an account or links accounts by email.

Invitations bind recipient UUID/email and both issuer/recipient credential epochs. Tokens are random 256-bit values, hashed in `role_invitations`, encrypted only while pending delivery, and carried in a browser fragment. They expire after 72 hours. Acceptance requires the matching authenticated local account and fresh password proof. The same access-control lock serializes invitation acceptance against role changes; issuer authority and both epochs are rechecked. Acceptance, role grant, audit and session invalidation commit atomically. Password reset, role/session revocation or disable/restore makes earlier invitations unusable; the administrative list renders these as revoked. A successfully accepted invitation cannot be replayed.

The additive migration grants runtime updates only for acceptance/revocation timestamps. The worker cannot read invitations directly. Its eligibility view exposes only unfinished eligible recipient deliveries. Mailpit SMTP acceptance is recorded as accepted, never claimed as human receipt. Provider uncertainty remains unknown and is not blindly retried. No environment variables or dependencies are added.
## 投稿與不可變修訂（Phase 3）

`apps/api/src/submissions/routes.ts` 僅處理 HTTP/CSRF/contract validation；`service.ts` 驗證真實 session、permission、owner 與交易；`policy.ts` 管理投稿窗口及提交完整性；`repository.ts` 管理參數化 SQL、RLS context 與版本。`dependencies.ts` 在同一交易查本地報名與 ready/owned manuscript files；不接受前端傳入 owner、registration id 或角色。

- 作者入口 `/submissions`；行政唯讀稿件與投稿設定入口 `/admin/submissions`。SDK `createSubmissionClient` 與 `useSubmissions` 負責網路／server state；呈現元件只接 props/callbacks。
- `GET /api/submissions/config` 回傳已登入者可見的投稿窗口、track/topic 與必要條件；`POST` 僅 `submissions.manage`。UTC ISO 時刻為權威，開放起點含、截止點不含；未設定窗口即關閉。
- `GET /api/submissions?scope=own|admin&offset=0` 每頁 20；admin 要求 `submissions.read_all`，不因此取得編輯他人稿件權。
- `GET /api/submissions/detail?id=...&scope=own|admin&revisionOffset=0` 回傳稿件與每頁 20 筆歷史，`nextRevisionOffset` 提供下一頁。作者只能存取自己的 primary ownership，表單內共同作者的 Email 不會自動綁定帳號。
- `POST /api/submissions/save` 使用客戶端 UUID 與 `expectedVersion`；空草稿為 0。競爭保存回傳 conflict。已提交稿件可在窗口內保存新草稿，但 `currentRevisionId`／`submittedVersion` 仍指向上次正式提交。
- `POST /api/submissions/transition` 明確 `submit|withdraw`。提交保存不可變文件及投稿設定快照、附件引用、稽核與 business outbox；同一版本重送不重複建 revision／通知。撤稿與審查結果分離，草稿不表示拒稿。
- 私有附件使用真檔案 SDK；未通過檢查不得加入或正式提交。附件與簡報都是 manuscript purpose，原檔名、storage key 不進公開 API。此工作台不提供公開稿件端點。
- RLS 使用 transaction-local `app.actor_id`／`app.submissions_admin`；missing context 無資料。Runtime 無 UPDATE/DELETE revision 權限。權限 shared fence → actor → config → manuscript 鎖順序；外部檔案掃描不在投稿交易內執行。

`tests/unit/submissions.test.ts` 覆蓋窗口邊界與完整性；`tests/integration/submissions.test.ts` 使用實際非特權 PostgreSQL role 驗證 owner/admin、並發保存、重送、immutable history、outbox 回滾、RLS context 與附件引用。附件 fixture 測試 ready 狀態與所有權，並不宣稱掃描器已驗證；掃描由 files suite 負責。

投稿修訂補充：稿件 `number` 由 PostgreSQL identity 發號，以字串 DTO 避免整數精度損失；UUID 仍作資源鍵。`keywords` 及 `correspondingAuthorIndex` 分開保存；舊歷史缺通訊作者時保留 unknown/null，不推測為第一作者。正式提交要求有效通訊作者。已正式發布且仍為目前決議的補件要求，可在原投稿截止後允許作者保存及正式提交；只適用原 `currentRevisionId`，以 DB 時鐘判斷補件截止，提交新版本同交易填入 `new_revision_id`，不可重用。單純未發布的決議或補件 request row 不會開放窗口。

審查角色新增 RLS 可見性後，投稿作者入口仍明確驗證 primary owner；不把「資料庫可以讀到」當作作者授權。此防線有 reviewer RLS 可見但 own detail/save/withdraw 全拒絕的真 PostgreSQL 回歸測試。
## Review workflow (Phase 4)

`apps/api/src/reviews` separates HTTP schemas, authenticated service transactions, scoped persistence and pure rubric validation. A review assignment pins an immutable submission revision and immutable scoring-form version. New author drafts never replace the assigned paper. Invited reviewers explicitly accept or decline; accepted reviews support saved drafts and a final locked submission. Scores must match the exact rubric, stay within each maximum, and final submission requires every criterion plus author feedback.

The central registry grants reviewer/assignment, chair/decision and administrator/management permissions separately. A chair additionally needs a persisted exact track scope; conference administrators may manage assignments but cannot decide without chair authority and scope. Ownership, normalized author email and declared conflicts are checked at assignment, manuscript access, grading and decision/publication. Conflict declarations are durable and cannot be cleared by this workflow. The exclusive access-control lock fences review mutations against submission and access writers; reads hold the shared lock. Missing context fails closed under actual app-role RLS.

Double-blind assignments require explicit human confirmation that content and metadata are anonymous. Reviewer DTOs omit owner identity, email, presenter/corresponding-author metadata and original filenames. Single-blind DTOs include only author name and affiliation. Review file downloads require an accepted/submitted matching assignment, pass the review policy before and after disk I/O, and use generated filenames. This is not automatic anonymization of document contents.

Chair decisions are immutable versions. Draft decisions remain private; explicit publication changes the publication pointer, writes an immutable author-comment snapshot and queues a generic authenticated-navigation notification in one transaction. Author results use a dedicated owner-scoped view and include only published outcome/message/deadline and the snapshot of author-facing comments; scores, reviewer identity and internal comments stay private. Published revision requests pin the original revision and are fulfilled by a new submission revision through the submission service.

## 議程（Phase 5）

`program` 模組保持 routes → service/policy → repository；SDK/hook 與 presentation 分離。`/admin/program` 配置會場、前後緩衝、不可排時段、Session、主持人、已錄取發表／邀請講者；`/program` 僅呈現已發布 projection。所有時刻以明確 UTC ISO 輸入／顯示，禁止無時區的時間字串。

PostgreSQL `btree_gist` exclusion 約束保護會場 booking、主持人／報告者及同 Session 非壁報 slot 的時間不重疊（半開區間）。Session booking 包含前後各一段設定緩衝；不可排時段使用同一會場 booking 約束。不同會場也不能排同一 presenter/chair Email 的重疊時段；Email 僅作私有衝突識別，從不因相同 Email 自動授權帳號。Session 範圍縮小不能截斷已排 slot；壁報編號及每稿一次排程由 unique constraints 保護。

排程寫入／發布短交易使用既有 access exclusive fence，與作者 withdrawal、review publication 串行化 eligibility 檢查；一般草稿讀取使用 shared fence。沒有外部 I/O 在鎖內。行政草稿以單一版本做 optimistic concurrency，限制會場100、不可排1000、Session500、slot5000；此界限是 v1 aggregate 保護，超過規模需分頁／分區演進。

安排稿件時只讀 `published_acceptances` 與指定 immutable revision，發表類型必須相符，撤稿不得新安排／發布。發布重新檢查每篇稿件，保存不可改寫 JSON snapshot 與稽核、outbox；重送同版本回傳同一 publication。公開 projection 只有時段、題目、姓名／單位、會場、主持人及壁報編號，不包含 Email、摘要、附件、owner id 或審查資料。已發布版本不因新草稿／後續撤稿自行改寫；行政須移除已撤稿 slot 並重新發布，舊公開快照保留原發布歷史。
