# ADR 0002 — Phase 1.1 identity, session and capture-only mail

> Historical record. The shared multi-tenant/global-account premise and membership/switch follow-up are superseded by [ADR 0003](0003-single-conference.md). Original implementation/test claims below describe their dated delivery, not current authorization.


Accepted within Phase 1.1 on 2026-10-15. No tenancy/membership, MFA product, external SMTP provider or Phase 1.2 authorization.

## Identity and credentials

Platform `users` are global, accessed only through the explicit identity service. No global role/admin property and no missing-tenant bypass. `withTenant` remains mandatory for later tenant data. Identity tables intentionally do not pretend to be conference-scoped RLS data; runtime grants restrict access, worker sees a purpose-specific eligibility view rather than user credentials. Migration owner remains separate.

Email uses Zod email validation, trim, lowercase entire address, DB uniqueness/check; dots and plus tags are preserved. This is a documented product comparison policy, not a claim every SMTP server treats case identically. Concurrent registration uses unique constraint + user lock. Re-registration never changes an active identity.

Argon2id uses 19 MiB, 2 iterations, parallelism 1, matching the OWASP minimum checked on this date. No benchmark/capacity claim. Passwords count 15–128 Unicode code points, max 512 UTF-16 code units, preserve whitespace/Unicode without trimming or truncation. A versioned-in-code local blocklist plus common-base/repetition/email checks is an offline baseline, not a complete compromised-password database. A larger vetted corpus/breach screening and capacity measurement remain pre-launch work. Login validates a random dummy Argon2 hash for absent/pending credentials; mail requests do bounded Argon2 work for all anonymous outcomes. This reduces obvious fast returns, not a claim of indistinguishable nanosecond timing.

Opaque 32-byte random session/token values have SHA-256 lookup hashes. Credential version and a user lock serialize session issuance with verification/reset. Reset updates credential, consumes token, revokes all sessions and persists security notification in one transaction; no automatic login. Session reads always consult PostgreSQL, with idle and absolute expiration. No Redis session cache.

Verification/reset tokens have separate purposes, expected email, used/revoked state and bounded expiry. Reissue **does not revoke existing unexpired links**, preventing unauthenticated resend from invalidating the owner's inbox. Successful consumption revokes sibling tokens of the same purpose. Verification only accepts pending users; reset only accepts active users. GET never consumes a token. Links use configured origin plus URL fragment, never request Host or returnUrl.

## HTTP and browser

Maintained Fastify CSRF plugin + signed HttpOnly secret cookie; anonymous GET `/api/auth/csrf` obtains a token, SDK submits it in a header for every mutation. Exact Origin allowlist protects login and anonymous recovery as well as logout. Host-only HttpOnly SameSite=Lax session cookies use `__Host-` with Secure for HTTPS; explicit development/test loopback HTTP uses `dev-` names. Production HTTP origins fail startup. `no-store`, no-referrer and safe error envelopes apply; no credential returned in JSON.

Browser transport stays in SDK, data hook cancels/removes private queries before mutations and on session expiry. Full navigation after login/logout creates a fresh app query client. A delayed response cannot reinsert the previous user's account. No persistent browser credential storage. Existing minimal CSS/primitives remain; no new design framework/router/form library is justified for these few standalone paths.

Redis atomically counts source (100/15min) and account/purpose (login 10/15min, mail/consume 5/15min) using keyed hashes. Register/resend share a verification bucket. No permanent lockout; rate-store failure gives 503. Queue health is independent of DB-backed session reads/logout. `trustProxy` remains disabled; deployments must explicitly design trusted proxy/source-IP handling before launch.

## Durable notifications

`notifications` is the persisted identity outbox, not an SMTP-in-handler shortcut. Its schema admits only identity scope today. Future tenant notification scope must be added explicitly, without interpreting NULL tenant IDs as universal access. Domain mutation, token and notification intent commit together. BullMQ contains only `{eventId}`.

`notification_secrets` stores a short-lived AES-256-GCM encrypted link with random 96-bit nonce, authenticated notification ID/key version, and expiry. Encryption key lives outside DB/repository; API can INSERT but cannot SELECT delivery secrets, worker can SELECT/DELETE but cannot read password/session/token hashes. The worker validates the trusted eligibility projection again before sending. Retries use the same encrypted link/token. Ciphertext is deleted on terminal state or expiry.

States: pending → processing/claimed → processing/sending → accepted, failed, unknown or cancelled. Lease is 60s. Expired claimed work returns to pending; expired sending work becomes unknown. Only DNS/connection failure explicitly classified as SMTP `CONN` can retry, at most three attempts with 30s delay. Other send errors are conservatively unknown. SMTP accepted means accepted by the capture server, not inbox delivery. A crash after acceptance and before DB commit is unknown and is not automatically resent. DB polling reconstructs missing queue entries; DB status/claim IDs deduplicate duplicate jobs. No exactly-once external effect claim.

SMTP adapter has no credentials or external hostname option, only existing Mailpit hosts/ports. Message links/addresses never enter logs/queue payloads. Minimal audit stores event/user/request/event IDs, no raw credentials or request bodies. Local Mailpit remains an intentionally sensitive development inbox and must not be exposed publicly.

## Dependencies and verification

Existing stack/pins retained. Registry metadata and official interfaces checked before installation:

- `argon2` **0.45.1**: maintained Argon2 implementation/native binding (Node >=16.17); requires its reviewed native build/prebuild installation.
- `@fastify/cookie` **11.1.3** and `@fastify/csrf-protection` **8.0.2**: Fastify 5 cookie/signing/CSRF integration rather than custom CSRF cryptography.
- `nodemailer` **10.1.1** (Node >=20) and `@types/nodemailer` **8.0.2**: bounded SMTP capture transport and compile-time types; compatibility verified by typecheck and actual Mailpit.
- API adds the already-pinned Zod **4.6.7** as an explicit direct import; root tests add already-pinned ioredis **5.11.1**. No alternate frameworks or general workflow engine.

Official references checked: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Fastify plugin](https://github.com/fastify/csrf-protection), [node-argon2](https://github.com/ranisalt/node-argon2), [Nodemailer SMTP](https://nodemailer.com/smtp). Project-specific policies are our choices, not claims that these sources prescribe this exact schema.

Migration `0003_identity_grants.sql` narrows runtime UPDATE privileges to required lifecycle/delivery columns and limits the worker eligibility projection to pending/processing notifications. It is a separate forward migration because 0002 had already been exercised locally; 0001/0002 are not rewritten. Actual-role regression rejects recipient/token reassignment, email edits and expiration/hash rewrites outside the implemented services.
