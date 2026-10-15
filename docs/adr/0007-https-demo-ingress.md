# ADR 0007: Caddy ingress for a public synthetic demo

Date: 2026-10-16. Status: accepted for the user-authorized domain demo tooling.

## Context and focused Phase 0 recheck

The owner requests HTTPS and one-command demo deployment, and reports that Cloudflare DNS-only for `confsys.fearnot.tw` points at their server. Inspected README/SPEC, agent instructions, package manifests, migrations through 0060, CI, demo Compose/seed, web ingress and auth cookies. No database or business-module change is needed. Evidenced deployment blockers in the existing local template: plain HTTP only for loopback, published local web port, development runtime settings, and no TLS termination/certificate lifecycle. Existing HTTPS-origin cookies already enforce Secure/HttpOnly and canonical Host/Origin/CSRF; preserve these rules and nonprivileged DB roles.

## Decision

Add a dedicated Compose overlay over the existing local demo, managed by a POSIX shell wrapper. Pin Caddy **2.11.7-alpine** to multi-platform manifest `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`; release/version and Docker manifest were verified on this date. This is the only added runtime dependency; no npm dependency or lockfile change. Caddy provides automatic ACME issuance/renewal and HTTP redirects without a DNS API credential or host package installation. Alternatives: Nginx plus separate ACME tooling adds certificate orchestration; relying on an existing host proxy prevents a self-contained first install. Existing host ingress owners must arrange their own integration rather than have this script seize ports.

Only Caddy publishes public 80/443. Explicit Compose port replacement removes the base web publication and forces Mailpit onto loopback. Compose >=2.24.4 is required for `!override`. API/web/worker/seed use production runtime configuration with the same exact HTTPS origin; this does not certify production readiness. No forwarded client identity is trusted; existing shared source rate limits remain an explicitly documented demo limitation.

`config.sh` centrally validates the deployment selector inputs, never sources an env file, persists a mode-0600 operational config, and rejects environment/saved identity disagreement. Application config validation remains authoritative for runtime secrets/origins. The original local demo shares a complete operator secret file with runtime containers; the public overlay fixes that evidenced credential exposure with a one-shot role-file derivation. API and worker each mount only their own connection/signing/encryption settings; web mounts no application secrets. Only operator provisioning/migration/seed can read the complete source file. No database credentials are rotated or schema changed. The wrapper seeds over the private network before first public startup, validates public TLS without skipping certificate checks, and retains all volumes on failure/down. There is no reset option. Existing local demo commands and containers remain independent.

## Verification and consequences

`pnpm test:demo:https` builds an isolated random-project stack with real PostgreSQL, Redis, Mailpit, application and Caddy; it verifies the unmodified public exposure configuration, then uses a test-only internal CA and loopback ports. Clients explicitly trust that temporary CA and verify hostname/TLS. Cases cover redirect, cookies, real administrator login, foreign-origin rejection, protected data, logout revocation, retained publication and idempotent seed after down/up. No public ACME calls, production data or weakening of existing tests. CI runs this as an additional step; it complements `pnpm check` and two-instance isolation.

Public DNS, firewall/NAT, public issuance/renewal, resource sizing and full demo disaster recovery are not proven by local CA tests. Operational instructions and failure/recovery behavior are documented in deploy/https-demo/README.md; remaining launch gates belong in ROADMAP/OPERATIONS.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [release 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), [Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).
