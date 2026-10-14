# Local operations and deployment limits

Compose services are project-namespaced, persistent volumes are local, mapped ports bind to 127.0.0.1 only. PostgreSQL official entrypoint bootstraps roles before accepting application use; app images run as node (non-root). Redis is persistent AOF/noeviction; cache and queues share only the development instance. Mailpit has no relay configuration. No real email sender or payment adapter exists.

Migration is a separate command/container under confsys_migrator, serialized by a PostgreSQL advisory transaction lock. The ledger tracks SHA-256 checksums, rejecting edited applied migrations. Migrations are forward-only; write an explicit repair/forward migration after review, not automatic down migrations. API and worker readiness require the foundation migration and safe database roles. Applications never get migrator/admin credentials through Compose service env.

Development app images contain build dependencies; do not treat them as hardened production images. Before production: separate queue/cache instances, TLS/reverse-proxy controls, managed secrets, restricted network access, backup policy, object storage, logs/metrics/alerts, vulnerability review, public rendering, capacity testing, provider sandbox verification and actual authorization/session flows. `NODE_ENV=production` is a runtime optimization, not a production-readiness certification.

## Shutdown and recovery

`pnpm dev` runs all three processes with signal propagation; API closes DB/Redis on Fastify close, worker stops accepting jobs and waits for the active synthetic processor before closing dependencies. Containers use init and 15-second grace. Future long-running handlers need explicit cancellation/deadlines and crash/retry tests.

Restart infrastructure with `pnpm infra:up`; restart app containers with `docker compose --profile app up -d --no-build --wait api worker web`. Readiness must recover; liveness is intentionally independent of dependency outages. Host `pnpm dev` and container Web share port 25173; choose one at a time. Never stop unrelated host processes to free these ports.

## Backup/restore procedure (documented, restore drill unverified)

For an isolated local rehearsal, after generating local credentials and starting the matching Compose project:

```sh
docker compose exec -T postgres pg_dump -U postgres -Fc confsys > /tmp/confsys-local.dump
# Create a separate restore database; never overwrite the source database.
docker compose exec -T postgres createdb -U postgres -O confsys_migrator confsys_restore
docker compose exec -T postgres pg_restore -U postgres -d confsys_restore --exit-on-error < /tmp/confsys-local.dump
```

A real production plan must also back up cluster roles/ownership, encrypted secrets and private storage with coordinated retention. Validate checksums, migration state, counts, referenced objects, keys and authorization in the restored isolated environment. Define RPO/RTO with the organization; no values or successful restore claim is invented here. Dumps contain sensitive data once real records exist and need encryption/access controls. Do not commit backups. Phase 0 has no real user data or object storage to restore.
