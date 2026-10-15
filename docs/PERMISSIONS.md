# Permissions and instance isolation

## Current enforcement

Each instance has its own database, Redis, credentials, host-only cookies and capture mailbox. There is no organization tenant, membership, default organization, global account registry or request-selected database. Anonymous health responses disclose status only. `/api/instance` returns only the validated conference display name. Web and non-health API routes reject a noncanonical Host; mutation Origin must match configured origin and CSRF must validate. Forwarded headers confer no trust.

Anonymous registration/resend/recovery retain indistinguishable accepted responses. Pending accounts alone activate; active accounts alone reset/login. Disabled accounts cannot activate, reset or use sessions. `/api/auth/me` resolves only the session owner; no user/scope override exists. Login loads only persisted local roles and their explicit permissions. First registration does not become administrator.

API and worker are actual non-owner NOSUPERUSER/NOBYPASSRLS roles, unable to SET ROLE migrator or change policies. API cannot SELECT encrypted delivery secrets; worker cannot SELECT users/passwords/sessions/tokens. Column grants prevent recipient/token reassignment and unsupported identity edits. Notifications admit local identity purpose only; future resource notifications require explicit policies/grants. No production RLS was disabled. Historical tenant fixture is retired; current deployment-isolation evidence comes from `test:instances`, with DB privilege/transaction tests retained.

## Phase 1.2 implemented matrix

| Permission | Ordinary verified account | conference_staff | conference_admin |
|---|---|---|---|
| Own authentication/account flows | Yes | Yes | Yes |
| `accounts.directory.read` | No | Yes | Yes |
| `access.roles.manage` | No | No | Yes |
| `accounts.status.manage` | No | No | Yes |
| `accounts.sessions.revoke` | No | No | Yes |
| `security_audit.read` | No | No | Yes |
| `site.draft.read` | No | No | Yes |
| `site.draft.write` | No | No | Yes |
| `site.publish` | No | No | Yes |

The sole mapping is `packages/policy/src/index.ts` (the API policy module reexports it); unknown permission/role/missing actor denies. Each service receives an opaque server-session credential, resolves current account/version/roles in this database, and performs its own policy check. No caller-supplied actor DTO, role, permission or tenant selects authority. The UI consumes capability keys only for visibility. Directory/detail disclose ID/email/state/verified/roles, with no passwords, credential versions, raw session IDs or detailed login history for staff.

Management requires a password checked within the last five minutes on the current session. Self role/status changes reject `SELF_CHANGE`; self session revocation is allowed. Only verified password-bearing accounts may be managed; grants additionally require active status. Disabled accounts can have bindings revoked before restoration. All effective role/status changes revoke sessions and advance the existing credential version. Disable revokes recovery/verification tokens; restoring never revives them or deleted bindings. Duplicate grants/revokes/status commands return `{changed:false}` with no new mutation audit/revocation. Forced logout always fences concurrent login and returns changed true.

A singleton transaction lock serializes management, rechecks actor after waiting, and enforces an active verified password-bearing admin remains after bootstrap. Audit failure rolls the whole transaction back. Runtime cannot UPDATE/DELETE audit or reset the bootstrap marker. Resource RLS is not invented for this local directory; service permissions and database grants are the current boundary, while separate databases enforce deployment isolation. This does not protect against a DB owner or compromised host.

Operator CLI bootstrap is preview by default, explicitly applies once to a local verified active account, requires selected-origin confirmation/reason, revokes prior sessions and records `operator_cli`. It is not an HTTP endpoint/seed/startup hook. See OPERATIONS for actual commands. Completed same-target attempts never regrant; other targets reject. Local invitations now use short-lived single-use verified acceptance; there is no emergency force-admin command.

## Resource roles implemented in the continuous run

| Principal / relationship | Planned authority | Exclusions |
|---|---|---|
| Anonymous | Explicit published conference projection | drafts and private data |
| Conference administrator / secretariat | bounded local configuration/delegation | implicit access to confidential manuscripts/finance |
| Finance | orders/reconciliation/receipts | blind review content |
| Chair / track | assignments/decisions in authorized track | self-review/conflicted work |
| Reviewer / assignment | accepted assigned work and permitted fields | unassigned work/hidden identity |
| Judge / competition assignment | assigned entries/rubric | own/unrelated work |
| On-site staff | minimal check-in/redemption | unrestricted exports/manuscripts |
| Author / owner | own authorized records | others' private resources |

Resolve session → local subject → resource relationship and action policy; fail closed on missing/revoked permission. One person may be author and reviewer but never self-review. Fixed templates and granular actions precede arbitrary policy engines. Private downloads reauthorize on creation and download; published DTOs exclude drafts; ID substitution and revoked permissions require tests. Browser visibility is never authorization.

The future-role table is planning only: those roles are not assignable. MFA remains a high-privilege launch gate. Production cookies require HTTPS/Secure/HttpOnly/SameSite and no Domain; local HTTP development exception and Chromium tests do not verify production TLS.

## Phase 1.3 site permissions

`site.draft.read` covers current draft, exact saved-version preview and paged history. `site.draft.write` covers save and loading history into a new draft. `site.publish` additionally requires existing five-minute session password proof. Staff retains only directory.read. All site private service entry points resolve and revalidate the opaque session after the shared access lock, then check the same role registry. CSRF/exact Origin protect every write. No anonymous preview token/query flag exists; `GET /api/site` always selects the official snapshot even with an admin Cookie.

App can SELECT/update the singleton's editable columns and INSERT/read publications; no publication UPDATE/DELETE. Worker cannot SELECT site tables or edit brand snapshots. Public snapshot projection excludes publishedBy, audit, draftVersion and history metadata. Deployment isolation remains separate DB/Redis/mail/secrets, without a tenant resolver or cross-conference accounts.


The executable registry is authoritative. `conference_admin` has explicit registration/submission/review/program/competition/onsite/reporting/notification grants; it does **not** implicitly receive finance permissions or chair decisions. `finance` handles reconciliation/refunds/receipts, `chair` decisions only in persisted track scope, `reviewer` its assignments, `competition_judge` its assigned qualified entries, and `onsite` check-in/redemption with minimal projections. Ordinary users access their owned records; arbitrary caller user IDs never grant authority. Explicit author preview is read-only, requires recent proof and reason, and audits actor/subject without becoming an author session.

Private file metadata is deny-by-default RLS. Trusted services establish transaction-local owner/media/specific authorized-file context after checking relationships. Public media requires an active site publication reference. Worker access uses narrow status/eligibility views and the same pure permission registry; access coordination grants only the singleton column, not bootstrap identity. CSV/PDF workers recheck current authority before making outputs available, and downloads recheck session/roles. CSV expiry is24hours; unknown SMTP outcomes cannot be treated as a known-safe resend.
