# Continuous run — 2026-10-15

Start: 06:08:11 Asia/Taipei. Fixed deadline: 10:00 (02:00Z); integration cutoff 09:35.
Baseline: 9642a62, verified descendant of d4c0788. Branch: codex/phase-1-4-to-6-continuous. Worktree: /Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous.

## Plan and ownership
Main: private files/media then registration/finance and dependent workflow; owns migrations/contracts/permissions/lockfile. Separate invitation agent owns invitation-specific source/tests, proposing central changes for main review. Existing stack and access fences retained. No provider credentials required: local storage and Mailpit only.

## Current scope status — 08:07 Taipei

All rows describe implemented source plus actual verification; none imply production readiness or completion of every SPEC requirement.

| Requirement | Current state | Evidence / remaining work |
|---|---|---|
| Phase1 files/media/local invitations | Implemented, integration verified | Real scanner clean/EICAR/limit rejection, private authorization, invitation acceptance; two-instance rehearsal30cec03e passed07:41 |
| Phase2 registration/forms/prices/capacity/finance/activities/receipts | Core implemented and browser verified; repairs integrating | Conditional forms/history, group allocation/refunds, immutable receipt PDF; safety migration0036 scoped4/4, receipt reissue and allocation pagination browser passed; terminal void and pagination PG passed |
| Phase3 submissions/authors/revisions/files/withdrawal | Implemented and verified | Author/admin browser flow, postacceptance deadline pinned; dedicated presenter-change consent/approval (0044) passed 5 real integration tests; first browser regression currently running |
| Phase4 reviews/conflicts/screening/decisions/publication | Implemented and verified | Blind review browser flow, track permissions, conflict gates, screening/reminders; bulk result operations remain to assess |
| Phase5 program/competitions/awards | Implemented and verified | Program publication and competition browser flows, immutable snapshots/personal schedule; deadline gates scoped tests passed |
| Phase6 onsite/PDF/notifications/stats/exports/site/preview | Core implemented; further capabilities in progress | Onsite real QR/PDF, real background CSV, notification retries, controlled preview, optional site pages; notification templates/audience/scheduling/release integrated,12 PG passed; reissue integrated and browser passed |

## Environment and verification

Pinned Node24.21.0/pnpm10.34.7 at /tmp/confsys-tools/node_modules/.bin. Own project confsys-continuous-20261015; Web56179 API54000 worker54001 PG56442 Redis57392 Mailpit59032 SMTP52032; hostname continuous-20261015.localhost. Native scanner127.0.0.1:53310; own failed container scanner stopped, old containers untouched. Synthetic test database confsys_test and Redis/1 only.

Latest full `pnpm check` at07:13–15 passed lint/typecheck/unit48/integration128/contract15/build/E2E19. Later `pnpm build && pnpm test:e2e` passed22 browser flows at07:24; current scoped unit55, contract16 and lint/typecheck passed. Newer feature changes require the next full regression; do not combine these into a claimed full current-suite pass.

Latest source checkpoint: d0b85ca (08:01); migrations through0051 integrated. Current pnpm check passed lint/typecheck, 66 unit, 173 integration, 16 contract tests and build; 25 browser tests are still running, so full current-suite success is not yet claimed. Proposed0052 pins approved presenter identity in personal program publications; proposed0053 closes direct payer verification writes and repairs refund replacement settlement. Agent branches remain independent; only reviewed changes are integrated.

## Focused baseline review
Reviewed existing session/access locks, site service/repository, runtime role/transaction helper, contract registry, scripts/migrations and CI. Preserve post-lock actor checks and explicit permissions. No evidenced inherited blocker so far. Existing MFA/TLS/retention/backup/provider debt remains in ROADMAP. New file safety must fail closed and cannot claim a stub scanner is verified.

## Historical checkpoints
The entries below are chronological evidence; the current state is summarized above.

## 06:22 checkpoint
- Latest main checkpoint 9b0e1e2 (central schemas/contracts WIP); app migrations 0001–0013 applied. New finance/review services still integrating; Phase2/3/4 are not complete.
- Main integrates invitation e626270, file125d4e8/media44dc43d, review download d68ff55, invitation/business tests1b3eb00, submissions0a68989, registration7da1479, wiringbe540ad. Subagent commits are cherry-picked only into this new branch.
- Tests: main registration unit4 pass; main typecheck passed through latest source; invitation agent real PG/Redis/Mailpit7 pass; business mail2 pass; submission agent scoped integration8 pass after fixing test observer/finally cleanup, unit6 pass. These are scoped evidence, not a full suite result.
- Failures: outbox ON CONFLICT lacked SELECT(event_key), fixed forward0011 + real rerun. Historical migration test expected5 and must be updated to exact current filenames/checksums. Original admin permission-count assertion updated to explicit list but next role additions need review. Clamd OOM at1536MiB and3GiB on existing Docker VM total3.828GiB; all old containers remain untouched. Files remain quarantined. Do not claim scanner integration pass; pursuing safe local option while independent work continues.
- Coordination slots: no agents running shared PG tests now; main can test registration. Files agent building real receipt PDFs+immutable metadata, review agent Phase4, submission agent revision requests+Phase5. Main finance+registration+integration.
- Dependencies verified/pinned sharp0.35.5, pdf-lib1.17.1; @pdf-lib/fontkit1.1.1 installing. New ClamAV image pinned sha256:9a96980b265cb2b51a20bdcca921dc80aa55ed0e56cdfb076198ee27a9171927 (daemon1.5.4). Local file env and per-project private/clamav volumes added; no production provider.

## 06:36 checkpoint
- Integrated Phase3 extension/number/corresponding-author patch de1ba70, receipts9a53f53, reviews e7f3673, program08341e4. Main routing now includes /reviews, /receipts, /admin/receipts, /program and /admin/program; browser integration still pending.
- Real native ClamAV1.5.4 started within ignored .tools at06:30:51 with official full signatures. Original signed notarized Cisco package verified; extracted locally, added local dylib rpath and ad-hoc signed extracted executable only. No global install/system settings. Stopped only this run's OOM clamd container, no original containers changed. Main file integration5/5 passed at06:33:40 (includes HTTP authorization/CSRF and actual scan).
- Scoped agent verification: receipts3/3 real PG plus3 rendered CJK pages, reviews8/8 with actual scan/download, program5/5, submissions10/10. Main typecheck pending after integrated fixtures. No full regression/build/E2E pass claimed yet.
- Main new0018 activities,0019 onsite+role+settlement view,0020 competition schemas applied to synthetic app DB. Activities backend is WIP, UI/tests pending; onsite/competition implementations proceeding separately. Main owns forward migration numbering; never rewrite applied migration.
- QR encoder qrcode1.5.4/types1.5.6 pinned for onsite QR; required separate QR_SIGNING_KEY generated by env:setup and configured only server-side. No secrets logged.
- Shared PG test slot currently free. Next: activities tests/UI, registration editing/promotion, full integration wiring; agents onsite,competition,notification/reporting. Current remaining requirements are not waived.

## 06:45 checkpoint
- Shared registry moved without changed grants into @confsys/policy, reused by API and pending document/mail worker jobs. Central migrations23–26 applied app DB: redemption cancellation invariant, registration version/history/pinned waiting-price, narrow competition qualification/count views, bounded PDF jobs eligibility, notification batches.
- First full E2E: `pnpm exec playwright install chromium && pnpm build && pnpm test:e2e`: build passed, E2E10 passed/3 failed in4.7m (invitation role/review paper/submission track exact select label timeouts). Concurrent source editing also caused Vite HMR re-root messages; next runs use built Vite preview assets with existing same-origin API proxy. Fix actual label association and retain behavior assertions, then rerun.
- Main activities integration5/5 passed (actual app role, direct SQL capacity, independent addon orders, immutable snapshots, deadline/admin cancellation, redeemed guard, audit rollback). Finance evidence download and notification updates implemented; new coverage pending. Registration edit/history/FIFO promotion now implemented backend/UI; tests pending.
- Full unit37/37, contract15/15 and build passed before latest registration/jobs changes. Main typecheck passed after integrated UI work at06:43. No latest full regression claim.
- Local native scanner remains running session65685; official signature-backed main file suite5/5 pass. Onsite agent6/6 actual PG/Redis worker tests reported at06:44:57 (PDF/QR/leases/revocation); implementation integration pending.

## 07:04 checkpoint
- Main full integration `pnpm test:integration`: 117/117 pass (21 files, 27.35s, 07:02:24). Includes actual nonprivileged PostgreSQL, Redis, Mailpit, signature-backed ClamAV, document worker/QR, access revocation, FIFO promotion, payment evidence and withdrawal/publication/scoring races.
- Earlier 113-case run failed2: broad worker SELECT on access_control and new notification batch_id legacy snapshot. Fixed forward0029 column-only SELECT(singleton), preserving SELECT* denial regression; explicit old-column snapshot plus batch_id null assertion. Private file RLS0027 now applied and tests passed, scoped finance evidence context set only after payment relationship/finance authorization.
- Full contract15/15 and build passed at07:03 before optional site pages change. E2E18 running against immutable built preview, one competition flow failure being diagnosed; no E2E full-pass claim.
- Agent usage interruption occurred; user explicitly requested resume. Agents resumed from existing trees. No old environment or data changed. Current main28f889a plus integration source awaiting checkpoint; new0028 exportjobs proposal has not yet been applied. Latest source extends optional site pages preserving old required4-page documents; tests pending.
- Next: finish E2E diagnosis, integrate real CSV exportworker/UI, optional site publication tests, conditional registration fields/workbench, and focused remaining SPEC acceptance gaps.

## 07:15 checkpoint
- `pnpm check` completed successfully: lint/import boundaries, typecheck,48 unit tests,128 real integration tests,15 contract tests, build,19 Chromium E2E. Browser run1.1minutes; real Mailpit, CSV worker, QR redemption, PDF batch, blind review/screening/released decisions, competitions/awards, draft publication and session revocation all exercised. Synthetic source rate budgets reset only at independent test boundaries using exact per-run HMAC keys; production thresholds unchanged.
- New scoped site/registration/files regression23/23 passed07:13, including optional page draft isolation/fallback/XSS and conditional-field hidden-answer rejection. Registration history is now paginated and exposed in UI. Core form/finance modules formatted for handoff.
- New subsequent work not covered by that full build: lazy per-feature route chunks, dashboard (source typechecked), new Phase2 comprehensive browser test, personal published schedule mapping32 (pending source integration), badge templates and explicit safe notification retry (proposed).
- Main scanner restarted07:10:32 with encrypted-document and limit-exceeded heuristic alerts enabled; remains127.0.0.1:53310. Scanner setup3392465 and Docker gateway fallback documented, actual EICAR/oversize compressed-content checks performed by files agent. Container equivalent env directives added; new double-instance source is pending rehearsal.
- No push/merge/deploy, real provider, old container/data modification. Next regression will build lazy routes and exercise new finance browser scenario. Commit5cf3909 precedes pending central/source checkpoint.

### 2026-10-15 07:26 Taipei — browser integration and safety review

- `pnpm contract:generate && pnpm build && pnpm test:e2e`: **22/22 browser tests passed**, 4.1 minutes. Includes real conditional registration → group reconciliation → receipt PDF → activity cancellation/refund, dashboard revoked-session clearing, and known-failure notification retry.
- Current contracts typechecked and `pnpm test:contract`: **16/16 passed** after adding explicit private binary-download contracts. An initial test import used a non-root dependency; removed the import and retained structural assertions. Regenerated after concurrent integration changed submission contracts.
- Badge template API/UI/render integrated; scoped actual PG template + onsite **7/7 passed** in agent worktree. Deadline integration tests **39/39 passed** after aligning one assertion with existing forbidden-scoring response; no authorization assertion removed.
- Focused review found missing RLS on order_items/order_payers, missing activity owner composite constraints, activity deadline bypass through registration cancellation, and disabled payer revocation defect. Forward migration0036 and service regressions are being integrated. These are blockers until verified.
- Container native-scanner override used host.docker.internal but central host validation lacked that exact local gateway; fixed whitelist before actual container smoke. No arbitrary scanner host accepted.
- Next: safety regression, receipt reissue lineage, notification audience/template scheduling, isolated two-instance rehearsal and full regression. All phases remain under integration; not a full Phase6 completion claim.

### 07:33 — container storage defect and draft RLS

- Full integration initially140/141: only migration preservation comparison failed because0038 adds `available_at`; retained the exact legacy-field equality and added explicit `available_at=created_at` backfill assertion. Rerun with pagination integrated: **142/142 passed**. Actual capture-mail test verifies distinct From, Reply-To and SMTP ReturnPath.
- Two-instance run9d5dab76 passed eight isolation stages (accounts, sessions/tokens, administrator changes, Mailpit/worker isolation, restart/migration, multilingual site publication) then real file upload failed500. Inspection proved `/data/private` was root-owned0755 while API UID1000. Fixed image creation to node-owned0700 before volume initialization; startup now rejects unsafe/unwritable/symlink storage. No existing volumes were chmodded/deleted. Both failed-run projects stopped and retained; next run creates fresh resources. Storage unit5/5 passed.
- Catalog review found private program draft contacts lacked RLS. Forward0042 fences rooms/sessions/slots/bookings behind trusted program.manage context; public reads see only active immutable publication. Program+upgrade migration regressions **8/8 passed**, preserving the genuine temporal-exclusion assertion under authorized context and adding no-context read/write denial.
-0038 audience view scalar registration lookup needed to handle multiple cancelled historical registrations; corrected with forward0041 rather than rewriting applied0038.0040 reserved for verified account email changes.0037/0039 receipt reissue and terminal-void guard retained.

## 07:44 checkpoint
- `pnpm test:instances --native-scanner --scanner-port 53310 --image confsys:p6-8ecadf2e` passed using fresh run30cec03e: independent container/mail/identity/roles/branding, private real scanned uploads/submission attachment revisions, cross-instance denial, A restart leaves B unchanged. Image predates latest mailbox/scheduled inbox changes; not latest-source deployment claim.
- Initial run9d5dab76 exposed private volume root ownership; Dockerfile now initializes node-owned0700 directory and API startup fails closed on invalid storage. Second run8ecadf2e exposed test submission window null=closed; fixture now explicitly opens synthetic window, production rule unchanged. Both failed own projects stopped, volumes retained.
- `CONFSYS_ENV_FILE=.instances/30cec03e/a.env node --conditions=development --import tsx scripts/compose.mjs --profile app stop api worker` paused only own generated A writers. `node --conditions=development --import tsx scripts/backup-drill.ts --source-env .instances/30cec03e/a.env --validate-only` passed; same command without validate-only passed, evidence `.restore-drills/ed58cf47/evidence.json`. One file/reference restored with exact checksum, all table counts/sequences/migrations equal; actual app login RLS and pooled context reset pass. Generated PDF/CSV, stored envelope and QR counts all zero, so restoration of populated examples remains unverified. Probe envelope decrypt passed. Source untouched and writers remain paused; restore runs PostgreSQL only.
- Latest browser run23 cases:22 passed, badge size label failed; fixed explicit label/id and pending rerun. No assertion weakened. Main full integration142/142 passed07:31 before mailbox/release changes. New scoped run43 pass, review suite parse failure from cherry-pick conflict repair fixed; focused review rerun underway.
- Mailbox agent27 scoped PG tests passed (email6,HTTP1,competitions11,reviews9), recent proof/session revocation/alias conflicts/race covered. Main wiring+contract+40 migration integrated; main typecheck passed after fixing test merge syntax. Notification agent12 PG+2 unit passed with45; worker permission fence and released_at prevents scheduled inbox disclosure before authorized preflight.
- Next: current-source lint/contract/build/browser; presenter approval44 and competition successor46 with immutable history; Phase6 reporting gaps; complete regression after integration.

## 07:54 checkpoint
- New mailbox browser flow passed after handling same-document hash navigation; no token persisted to browser storage. Badge template and retry flows passed, notification audience/template/schedule flow passed after explicit textarea labels. Main `pnpm build && pnpm test:e2e tests/e2e/email-change.spec.ts tests/e2e/notification-batches.spec.ts`:2/2 passed07:48.
- `node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/business-mail.test.ts tests/integration/notification-batches.test.ts`:15/15 passed07:47, including real mailbox-confirmation race before worker preflight and Mailpit delivery only to the new address.
- Main latest unit63/63 and contract16/16 passed; lint/typecheck passed before latest central readiness change. Presenter44 agent5/5, competition successor46 agent11/11, purpose47/reporting12/12 +new48stats1/1 passed. Raw competition private table49 scoped12/12 passed in agent; source integration pending. New browser presenter/export changes await main full regression.
- Main central44/46/47/48 schemas, presenterAPI/UI/routes/contracts and purpose/stats source integrated. Readiness now tracks latest required migration, with a guard test preventing new schema additions from silently leaving startup checks behind.
- Completed synthetic30cec03e A/B anded58cf47restore containers stopped after detected Docker memory pressure (B API/workerOOM07:48); volumes/artifacts retained. Original containers unchanged. Native scanner and main synthetic PG/Redis/Mailpit remain available.
- Next actual work:49source integration thenfullcheck; single participant service lifecycle test across business modules; enrich next two-instance rehearsal with real PDF/CSV/QR/pending encrypted mail before restore. No Phase6-complete claim.

## 08:07 checkpoint
- Full regression in progress as above; previous failure of original direct email-update denial was fixed with0051 constrained confirmed-token mutation, preserving the original assertion. Auth/email focused21/21 passed.
- Real cross-phase participant service lifecycle1/1 passed07:57, including scanner, paid reconciliation, review/result, program/competition, QR/redemption, PDF and worker CSV. This is service integration evidence, not a browser claim.
- Two-instance30cec03e passed07:41 with imagep6-8ecadf2e; restoreed58cf47 passed07:42 with one private file but zero generated artifacts/QR/pending mail. New restore-fixtures helper is ready for a fresh latest-image exercise; enriched recovery remains unverified. Own rehearsal containers stopped and volumes retained after B app OOM; old environments untouched.
