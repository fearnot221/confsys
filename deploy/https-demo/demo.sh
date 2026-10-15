#!/bin/sh
set -eu
# Resolve the selector before changing directory, matching other repository tools.
config_file=${CONFSYS_ENV_FILE:-$(dirname "$0")/.env}
case "$config_file" in /*) ;; *) config_file=$PWD/$config_file ;; esac
cd "$(dirname "$0")"
. ./config.sh
command=${1:-up}
case "$command" in up|check|status|logs|password|down) ;; *) fail "usage: $0 [up|check|status|logs|password|down]" ;; esac
load_config
command -v docker >/dev/null || fail "Docker with Compose v2 is required"
version=$(docker compose version --short)
printf '%s\n' "$version" | awk -F. '{gsub(/^v/,"",$1); if($1<2 || ($1==2 && ($2<24 || ($2==24 && $3<4)))) exit 1}' || fail "Docker Compose >= 2.24.4 is required"
compose() {
  # Fixed file list: ambient COMPOSE_FILE / project / env selectors cannot change it.
  docker compose --env-file "$config_file" --project-name "$DEMO_PROJECT_NAME" \
    -f ../demo/compose.yaml -f compose.yaml "$@"
}
password() {
  compose run --rm --no-deps -T --entrypoint sh secrets \
    -c 'sed -n "s/^DEMO_ADMIN_PASSWORD=//p" /secrets/demo.env'
}
https_ready() {
  # No --insecure: report readiness only for a publicly trusted certificate.
  status=$(curl --fail --silent --show-error --noproxy '*' --connect-timeout 5 --max-time 10 \
    "$DEMO_ORIGIN/api/health/ready" --output /dev/null --write-out '%{http_code}') || return 1
  [ "$status" = 200 ]
}
case "$command" in
  up|check)
    command -v curl >/dev/null || fail "curl is required to verify public HTTPS"
    save_config
    compose config --quiet
    compose run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    if [ "$command" = check ]; then https_ready; exit; fi
    extra=
    [ "$COMPOSE_PROFILES" != scanner ] || extra=clamav
    compose up -d --build --wait --wait-timeout 300 web mailpit $extra
    # Seed completes privately before the first public proxy startup.
    compose run --rm --no-deps seed
    compose up -d proxy
    attempt=0
    until https_ready; do
      attempt=$((attempt + 1))
      [ "$attempt" -lt 18 ] || fail "HTTPS not ready. Services and data are retained; inspect logs, DNS A/AAAA, ports 80/443 and CAA, then rerun up."
      sleep 5
    done
    echo "Demo ready: $DEMO_ORIGIN/"
    echo "Sign in: $DEMO_ORIGIN/auth/login (admin@demo.invalid)"
    echo "Retrieve the administrator password privately: $0 password"
    echo "Mailpit: SSH tunnel to 127.0.0.1:$DEMO_MAIL_PORT (never public)."
    ;;
  status) [ -f "$config_file" ] || fail "Run up first"; compose ps -a ;;
  logs) [ -f "$config_file" ] || fail "Run up first"; compose logs -f --tail=100 proxy api worker web seed ;;
  password) [ -f "$config_file" ] || fail "Run up first"; password ;;
  down) [ -f "$config_file" ] || fail "Run up first"; compose down ;;
esac
