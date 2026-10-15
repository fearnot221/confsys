#!/bin/sh
# Operator-only one-shot: derive role-scoped runtime files without printing secrets.
set -eu
set -a
. /secrets/demo.env
set +a
umask 022
for role in api worker; do
  destination=/runtime-$role/runtime.env
  {
    printf 'MAIL_KEY_VERSION=v1\nMAIL_ENCRYPTION_KEY=%s\nQR_SIGNING_KEY=%s\n' "$MAIL_ENCRYPTION_KEY" "$QR_SIGNING_KEY"
    if [ "$role" = api ]; then
      printf 'DATABASE_URL=postgresql://confsys_app:%s@postgres:5432/confsys\nCSRF_SIGNING_KEY=%s\n' "$APP_PASSWORD" "$CSRF_SIGNING_KEY"
    else
      printf 'WORKER_DATABASE_URL=postgresql://confsys_worker:%s@postgres:5432/confsys\n' "$WORKER_PASSWORD"
    fi
  } > "$destination.tmp"
  chmod 444 "$destination.tmp"
  mv -f "$destination.tmp" "$destination"
done
