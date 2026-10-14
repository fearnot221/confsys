# Local private-file scanner

Uploads are quarantined until a real ClamAV `INSTREAM` scan returns clean. An unavailable scanner is not a successful scan. Owners can retry quarantined uploads after recovery. This guide covers the development fallback used when the existing Docker VM cannot allocate another scanner engine without disrupting other projects.

The default topology remains the digest-pinned `clamav` service in `compose.yaml`. Both native and container configurations must enable `AlertExceedsMax yes` and `AlertEncrypted yes`, so partial/unsupported scans cannot become a false clean result. The pinned image supports `CLAMD_CONF_AlertExceedsMax=yes` and `CLAMD_CONF_AlertEncrypted=yes`; its real `/init` configuration generation was inspected and tested. ClamAV recommends at least 3 GiB and explains why database reloads can temporarily require another engine; see [official Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html). Do not enlarge the global Docker VM or stop unrelated containers to make a test pass.

## Reproducible macOS fallback

Prerequisites: repository Node 24.21.0, macOS command-line tools (`pkgutil`, `install_name_tool`, `codesign`), network access for the official package and signatures, and sufficient host RAM/disk. No `sudo`, package installer, launch daemon, system directory, Gatekeeper change or global Docker setting is used.

From the integration checkout:

```sh
node scripts/local-scanner.mjs prepare
node scripts/local-scanner.mjs update
node scripts/local-scanner.mjs run
```

`run` stays in the foreground. Leave that terminal open; stop it with Ctrl-C. It does not kill or replace another scanner. A busy port causes an ordinary startup failure. In another terminal:

```sh
node scripts/local-scanner.mjs check
```

The helper reads `CONFSYS_ENV_FILE` (default `.env`) for existing `CLAMAV_HOST` / `CLAMAV_PORT`, and supports `--port 53310` for an explicit isolated port. The daemon always binds `127.0.0.1`. `check` requires PONG, a signature-loaded pinned engine, a clean synthetic stream, actual EICAR detection, and rejection of a compressed stream that exceeds scan limits. It writes no test virus file. The endpoint has no authentication and must never be exposed to the LAN/public internet.

`prepare` creates only ignored `.tools/scanner-1.5.4`. It downloads the [official macOS 1.5.4 package](https://www.clamav.net/downloads), requires SHA256 `df7fa753e2f9f67f3bc99b2a40a3be7ef559088c68ad6bdf66b4b5764e965bd6`, and verifies the Apple-trusted/notarized Cisco installer identity `DE8Y96K9QP` **before extraction**. It never runs the installer. Because the signed executables assume `/usr/local/clamav/lib`, the helper adds an executable-relative dylib search path to its own extracted copies and locally ad-hoc signs those two relocated executables. It preserves the verified original package, records runtime checksums in a manifest and rechecks them before each update/run. This is a local development relocation, not an assertion that the modified executable retains Cisco's signature.

For an already-downloaded original package, `prepare --package /absolute/path/clamav-1.5.4.pkg` still performs both hash and signature verification. It never accepts a substitute version or disables verification. A failed integrity check requires diagnosis; do not bypass it.

`update` runs the genuine FreshClam updater against `database.clamav.net`, using the package's certificate bundle and a private database directory. Keep signatures current. After an update, restart the foreground daemon and run `check`. Database freshness/provider availability is an external dependency; failure leaves uploads quarantined. Source: [official scanner setup](https://docs.clamav.net/manual/Usage/Scanning.html).

## Docker Desktop application smoke with the native scanner

Start the native scanner and verify it first. Use the explicit additional Compose file for this development run:

```sh
node --conditions=development --import tsx scripts/compose.mjs \
  -f compose.yaml -f compose.native-scanner.yaml --profile app up -d --wait postgres redis mailpit
node --conditions=development --import tsx scripts/compose.mjs \
  -f compose.yaml -f compose.native-scanner.yaml --profile app run --rm migrate
node --conditions=development --import tsx scripts/compose.mjs \
  -f compose.yaml -f compose.native-scanner.yaml --profile app up -d --wait api worker web
pnpm smoke:stack
```

Use the task's unique `COMPOSE_PROJECT_NAME`, ports, synthetic database and a versioned `APP_IMAGE` built from this checkout. These commands are not permission to change any other stack. The override only points this API at `host.docker.internal:${CLAMAV_PORT}` and moves the unused container scanner behind the explicit `container-scanner` profile. It does not alter default production topology. The scanner continues binding host loopback; Docker Desktop can reach that listener through its host gateway. Verify this connectivity for your Docker Desktop version before claiming upload smoke success.

`smoke:stack` checks the application/worker but does not itself prove antivirus detection. Run `local-scanner.mjs check` and the real files integration test too; inspect actual scanner results rather than a container's running status. A ClamAV container can have FreshClam alive after its `clamd` child was OOM-killed. Diagnose only this task's named container using its exit/OOM state and process list.

## Recovery and boundaries

- Native runtime/config/logs/signatures are local generated files under `.tools/scanner-1.5.4`; they are not source artifacts or backed-up user uploads. Do not commit them.
- Private user files remain under centrally validated `PRIVATE_STORAGE_ROOT` / the task's private-storage volume. The native scanner receives streams and does not need a shared storage mount.
- `cleanupIncompleteUploads` rejects and unlinks only stale, unreferenced uploading files, with rollback preserving retry after an unlink failure. Ready and referenced files are untouched.
- Package/signature download from scratch depends on upstream availability. An extracted runtime/version check, a live scanner check, and a full application upload are separate evidence; report each actually executed step.
- Linux uses the pinned container service. This macOS helper intentionally refuses native install/run elsewhere.
