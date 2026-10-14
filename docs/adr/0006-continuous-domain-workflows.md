# ADR 0006 — Transactional conference workflows and bounded background artifacts

Accepted 2026-10-15 within the explicitly authorized continuous Phase1–6 run. The single-conference deployment boundary and existing Node/PostgreSQL/Redis/Fastify/Vite stack remain unchanged. This decision documents implemented mechanisms; feature verification is recorded separately in CONTINUOUS_RUN and TESTING.

## Domain boundaries

Registration owns form/fee versions, capacity and registration lifecycle. Finance owns orders, payment declarations, allocation and refunds. Activities owns optional bookings and redemption eligibility; documents owns immutable receipt revisions and generated PDFs. Submission revisions, review decisions, program publications and competition scores are distinct records with separate lifecycles. A submitted draft is never a rejection, an allocation is not an external charge, and SMTP acceptance is not inbox delivery.

HTTP routes validate contracts and invoke services. Services resolve the local server-side session, use the existing access fence and permission registry, own transactions and invoke scoped repositories. API and worker share `@confsys/policy` rather than copying role maps. Domain packages expose their real artifact-generation/worker responsibilities; no service deployment or generalized workflow framework is introduced. Browser requests remain in SDK modules; feature hooks own server state and cancellation, while presentation imports DTO types and receives values/callbacks. Runtime schema options used by a control are supplied by its hook, not imported into presentation.

## Historical correctness and concurrency

PostgreSQL is authoritative for capacity, money, numbering, revision identities and redemption. Database locks, composite foreign keys, unique constraints and FORCE RLS defend invariants under concurrency. Redis only dispatches reconstructible work and enforces rate limits. Domain changes, required audit and outbox insertion commit atomically. Immutable form/price/revision/publication/receipt snapshots preserve what was accepted at the time; editing a draft does not mutate a published snapshot. Terminal receipt voids remain terminal and reissue creates a linked successor with a new number.

Jobs use persisted claims and leases. Notification recovery distinguishes a failure before SMTP from an uncertain result after sending begins; uncertain delivery is not automatically retried. Explicit operator retries create child batches and preserve the original delivery history. Scheduled inbox content is released by the worker's authorized preflight, with its access fence shared with role revocation. The same preflight returns the current recipient address, avoiding a stale email read if mailbox confirmation wins the race. SMTP remains external to the transaction, so no exactly-once guarantee is made.

## Files and document dependencies

Private file metadata and authorization remain in PostgreSQL, while bytes use each deployment's own private volume. Uploads are bounded and quarantined until actual content and antivirus checks succeed. Public media is a separate validated projection. `sharp`0.35.5 is used to decode/re-encode image media rather than trusting extensions or preserving arbitrary source metadata. ClamAV1.5.4 supplies real malware scanning; absence or failure leaves uploads unavailable rather than treating a stub as safe. The API verifies owner-only writable private storage during startup, and the image initializes it as UID1000 with mode0700.

`pdf-lib`1.17.1 generates receipts and badge PDFs without introducing an external rendering service. `@pdf-lib/fontkit`1.1.1 embeds the bundled licensed CJK font; this increases artifact size but supports actual names instead of substituting missing glyphs. `qrcode`1.5.4 encodes the existing signed, non-login onsite token. PDF and CSV work is bounded, persisted, authorized at creation and download, and can run in the independent worker. BullMQ is already part of the stack; no new queue framework is added. Package versions are pinned in the lockfile, and font license/source are retained with the asset.

## Operational limits and recovery

Forward migrations preserve existing rows and checksums. Newly introduced fields are explicitly checked in upgrade tests; prior-column equality alone does not prove backfill correctness. A matched application image should be used for API, worker and web. Migration startup is separate from concurrent application startup.

The synthetic two-instance rehearsal verifies independent sessions, data, workers, mail, private files and restart behavior using fresh identified resources. The same-instance backup drill pauses only its own source writers, restores a custom PostgreSQL dump and private bytes into fresh resources, and checks row counts, sequence positions, checksums, application-role RLS and pooled context reset. Retaining encryption/signing keys is deliberate for recovering the same instance and must not be used to clone a new conference. Zero fixture counts are explicitly recorded rather than claimed as populated artifact coverage.

Development mail is restricted to Mailpit and `.invalid` sender identities. Online payment and production delivery/bounce providers are unconfigured. These implementations do not establish production backup retention, disaster-recovery objectives, TLS/MFA, load capacity, complete accessibility conformance or provider verification; those require their own authorized evidence.
