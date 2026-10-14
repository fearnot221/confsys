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

The sole mapping is `access/policy.ts`; unknown permission/role/missing actor denies. Each service receives an opaque server-session credential, resolves current account/version/roles in this database, and performs its own policy check. No caller-supplied actor DTO, role, permission or tenant selects authority. The UI consumes capability keys only for visibility. Directory/detail disclose ID/email/state/verified/roles, with no passwords, credential versions, raw session IDs or detailed login history for staff.

Management requires a password checked within the last five minutes on the current session. Self role/status changes reject `SELF_CHANGE`; self session revocation is allowed. Only verified password-bearing accounts may be managed; grants additionally require active status. Disabled accounts can have bindings revoked before restoration. All effective role/status changes revoke sessions and advance the existing credential version. Disable revokes recovery/verification tokens; restoring never revives them or deleted bindings. Duplicate grants/revokes/status commands return `{changed:false}` with no new mutation audit/revocation. Forced logout always fences concurrent login and returns changed true.

A singleton transaction lock serializes management, rechecks actor after waiting, and enforces an active verified password-bearing admin remains after bootstrap. Audit failure rolls the whole transaction back. Runtime cannot UPDATE/DELETE audit or reset the bootstrap marker. Resource RLS is not invented for this local directory; service permissions and database grants are the current boundary, while separate databases enforce deployment isolation. This does not protect against a DB owner or compromised host.

Operator CLI bootstrap is preview by default, explicitly applies once to a local verified active account, requires selected-origin confirmation/reason, revokes prior sessions and records `operator_cli`. It is not an HTTP endpoint/seed/startup hook. See OPERATIONS for actual commands. Completed same-target attempts never regrant; other targets reject. No invitations or emergency force-admin command.

## Future roles and relationships — not implemented

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
