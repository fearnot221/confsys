# Files integration checkpoint

Branch `codex/continuous-files`, start 2026-10-15 06:09 Asia/Taipei. File feature aec55ed.

Implemented: private storage random keys/checksum/exclusive nofollow writes; bounded raster re-encode with sharp; bounded separate-worker PDF structural parsing; fail-closed local clamd INSTREAM; quarantine and explicit retry; owner downloads and purpose-restricted media manager; no public storage directory; public media requires active publication reference; immutable file metadata and history references; interrupted-upload cleanup. SDK owns network; hook owns server state; presentation accepts only callbacks/DTO.

Precise verification in this isolated worktree:
- `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH pnpm typecheck` passed.
- `pnpm exec vitest run tests/unit/files.test.ts tests/unit/site.test.ts tests/contract/files.test.ts tests/contract/site.test.ts` passed 10 tests (using pinned PATH).
- Targeted ESLint passed for file/site code before last media integration test extension; rerun final lint in main.
- `CONFSYS_ENV_FILE=<main new run .env> node --env-file=<same> node_modules/vitest/vitest.mjs run tests/integration/files.test.ts`: first run 1/4 passed, remaining three blocked by scanner unavailable, not accepted as validated. It proved quarantine behavior but ready path not yet verified. Main is provisioning real clamd; no stub used.

Fix found by regression: grouped repeating base64 regex overflowed stack on 12 MB input. Flat base64 charset regex now avoids that; strict canonical round-trip remains server enforced. PDF parser worker has 3s CPU wall timeout, 64MiB old-generation heap, rejects encrypted/invalid/zero/over-500-page files and parsed active-action names (including hex-escaped names). This is not content anonymization or complete document sanitization.

Limits: 100 assets and 200MiB per account, including rejected attempts to bound repeated failed uploads; no user deletion retention workflow yet. Upload JSON buffers max 8MiB bytes (body bound accounts for base64), not streaming large files. A process crash leaves uploading metadata; `cleanupIncompleteUploads(pool,root)` marks uploads older than one hour rejected and removes only corresponding bytes. Ready files cannot be deleted or rewritten through application grants. Local scanner deployment/readiness and browser media workflow still require main integration verification.

Maintainability: file service owns authorization/lifecycle; repository owns scoped persistence/projection; storage adapter owns filesystem/image/clamd; PDF parser isolates untrusted parsing; contracts shared DTO only. Added sharp/pdf-lib centrally pinned with concrete decode/parse needs (pdf-lib reusable for later PDFs). No second permission registry. Site service alone couples publication transaction to media reference policy. Integration tests use real app DB role; scanner tests distinguish protocol unit doubles from real EICAR integration.
