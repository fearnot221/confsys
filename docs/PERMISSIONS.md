# Permissions and instance isolation

## Current enforcement

Each instance has its own database, Redis, credentials, host-only cookies and capture mailbox. There is no organization tenant, membership, default organization, global account registry or request-selected database. Anonymous health responses disclose status only. `/api/instance` returns only the validated conference display name. Web and non-health API routes reject a noncanonical Host; mutation Origin must match configured origin and CSRF must validate. Forwarded headers confer no trust.

Anonymous registration/resend/recovery retain indistinguishable accepted responses. Pending accounts alone activate; active accounts alone reset/login. Disabled accounts cannot activate, reset or use sessions. `/api/auth/me` resolves only the session owner; no user/scope override exists. Login grants no business/admin permissions. First registration does not become administrator.

API and worker are actual non-owner NOSUPERUSER/NOBYPASSRLS roles, unable to SET ROLE migrator or change policies. API cannot SELECT encrypted delivery secrets; worker cannot SELECT users/passwords/sessions/tokens. Column grants prevent recipient/token reassignment and unsupported identity edits. Notifications admit local identity purpose only; future resource notifications require explicit policies/grants. No production RLS was disabled. Historical tenant fixture is retired; current deployment-isolation evidence comes from `test:instances`, with DB privilege/transaction tests retained.

## Phase 1.2 and later — not implemented

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

Controlled administrator initialization requires operator authority, one-time/auditable action and no public-first-user shortcut. MFA remains a high-privilege launch gate. These are plans, not implemented roles or permission claims. Production cookies require HTTPS/Secure/HttpOnly/SameSite and no Domain; local HTTP development exception and Chromium tests do not verify production TLS.
