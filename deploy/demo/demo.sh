#!/bin/sh
# Convenience wrapper for deploy/demo/compose.yaml.
#   ./deploy/demo/demo.sh up        build, start, seed; print URL and sign-in
#   ./deploy/demo/demo.sh password  print the generated demo admin password
#   ./deploy/demo/demo.sh logs      follow application logs
#   ./deploy/demo/demo.sh down      stop containers, keep data
#   ./deploy/demo/demo.sh reset     stop and delete all demo data and secrets
set -eu
cd "$(dirname "$0")"
# DEMO_SUBNET pins the network range when Docker's default pools are exhausted
# ("all predefined address pools have been fully subnetted").
subnet_file=""
if [ -n "${DEMO_SUBNET:-}" ]; then
  subnet_file="$(mktemp)"
  trap 'rm -f "$subnet_file"' EXIT
  printf 'networks:\n  default:\n    ipam:\n      config:\n        - subnet: %s\n' "$DEMO_SUBNET" > "$subnet_file"
fi
compose() {
  docker compose -f compose.yaml ${subnet_file:+-f "$subnet_file"} ${DEMO_COMPOSE_EXTRA:-} "$@"
}
origin="${DEMO_ORIGIN:-http://localhost:${DEMO_PORT:-8080}}"
export DEMO_ORIGIN="$origin"

password() {
  compose run --rm --no-deps -T --entrypoint sh secrets \
    -c 'sed -n "s/^DEMO_ADMIN_PASSWORD=//p" /secrets/demo.env'
}

case "${1:-up}" in
  up)
    # `up --wait` reports finished one-shot jobs as failures, so wait for the
    # long-running services first and run the idempotent seed in the foreground.
    # COMPOSE_PROFILES=scanner also starts the optional ClamAV scanner.
    case ",${COMPOSE_PROFILES:-}," in *,scanner,*) extra=clamav ;; *) extra= ;; esac
    compose up -d --build --wait web mailpit $extra
    if ! compose run --rm --no-deps seed; then
      echo "Demo seed failed; see the output above." >&2
      exit 1
    fi
    cat <<EOF

  Conference demo is ready (synthetic data only)
  Website   $origin/
  Sign in   $origin/auth/login
  Email     ${DEMO_ADMIN_EMAIL:-admin@demo.invalid}
  Password  $(password)
  Mailpit   http://localhost:${DEMO_MAIL_PORT:-8025}/

EOF
    ;;
  password) password ;;
  logs) compose logs -f --tail=100 api worker web seed ;;
  down) compose down ;;
  reset) compose down -v ;;
  *) echo "usage: $0 [up|password|logs|down|reset]" >&2; exit 2 ;;
esac
