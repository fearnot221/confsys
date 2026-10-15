# Shared, strict configuration loader for the HTTPS demo tooling.
# This file is sourced only by demo.sh; configuration files are never executed.
fail() { echo "HTTPS demo: $*" >&2; exit 1; }
load_config() {
  if [ -f "$config_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|'#'*) continue ;; esac
      key=${line%%=*}; value=${line#*=}
      case "$key" in
        DEMO_DOMAIN|DEMO_PROJECT_NAME|DEMO_MAIL_PORT|COMPOSE_PROFILES)
          # Saved identity wins only if the caller has not selected a different value.
          case "$key" in
            DEMO_DOMAIN) [ "${DEMO_DOMAIN-$value}" = "$value" ] || fail "DEMO_DOMAIN differs from saved configuration"; DEMO_DOMAIN=$value ;;
            DEMO_PROJECT_NAME) [ "${DEMO_PROJECT_NAME-$value}" = "$value" ] || fail "DEMO_PROJECT_NAME differs from saved configuration"; DEMO_PROJECT_NAME=$value ;;
            DEMO_MAIL_PORT) [ "${DEMO_MAIL_PORT-$value}" = "$value" ] || fail "DEMO_MAIL_PORT differs from saved configuration"; DEMO_MAIL_PORT=$value ;;
            COMPOSE_PROFILES) [ "${COMPOSE_PROFILES-$value}" = "$value" ] || fail "COMPOSE_PROFILES differs from saved configuration; edit the selected file"; COMPOSE_PROFILES=$value ;;
          esac ;;
        *) fail "Unsupported configuration key: $key" ;;
      esac
    done < "$config_file"
  fi
  DEMO_DOMAIN=${DEMO_DOMAIN:-}
  DEMO_PROJECT_NAME=${DEMO_PROJECT_NAME:-confsys-https-demo}
  DEMO_MAIL_PORT=${DEMO_MAIL_PORT:-18025}
  COMPOSE_PROFILES=${COMPOSE_PROFILES:-}
  printf '%s\n' "$DEMO_DOMAIN" | LC_ALL=C awk '
    NR>1 { exit 1 }
    length($0)>253 || NF!=1 || $0 !~ /^[a-z0-9.-]+$/ { exit 1 }
    { n=split($0,a,"."); if(n<2) exit 1;
      for(i=1;i<=n;i++) if(length(a[i])>63 || a[i]!~/^[a-z0-9]/ || a[i]!~/[a-z0-9]$/) exit 1;
      if(a[n]!~/[a-z]/ || a[n] ~ /^(localhost|local|internal|invalid|test)$/) exit 1 }
  ' || fail "DEMO_DOMAIN must be a public lowercase DNS hostname without scheme, path or port"
  case "$DEMO_PROJECT_NAME" in ''|*[!a-z0-9_-]*|[!a-z0-9]*) fail "Invalid DEMO_PROJECT_NAME" ;; esac
  case "$DEMO_MAIL_PORT" in ''|*[!0-9]*|0*) fail "Invalid DEMO_MAIL_PORT" ;; esac
  [ "${#DEMO_MAIL_PORT}" -le 5 ] && [ "$DEMO_MAIL_PORT" -ge 1024 ] && [ "$DEMO_MAIL_PORT" -le 65535 ] || fail "DEMO_MAIL_PORT must be 1024..65535"
  case "$COMPOSE_PROFILES" in ''|scanner) ;; *) fail "COMPOSE_PROFILES must be empty or scanner" ;; esac
  export DEMO_DOMAIN DEMO_PROJECT_NAME DEMO_MAIL_PORT COMPOSE_PROFILES
  # Never inherit local demo bindings or origins into this deployment.
  DEMO_ORIGIN=https://$DEMO_DOMAIN; export DEMO_ORIGIN
}
save_config() {
  [ -f "$config_file" ] && return
  # noclobber avoids replacing a concurrently created configuration.
  (umask 077; set -C; cat > "$config_file" <<EOF_CONFIG
DEMO_DOMAIN=$DEMO_DOMAIN
DEMO_PROJECT_NAME=$DEMO_PROJECT_NAME
DEMO_MAIL_PORT=$DEMO_MAIL_PORT
COMPOSE_PROFILES=$COMPOSE_PROFILES
EOF_CONFIG
  ) || fail "Cannot create configuration: $config_file"
}
