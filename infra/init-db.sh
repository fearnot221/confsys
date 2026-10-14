#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
 --set=migrator_password="$MIGRATOR_PASSWORD" --set=app_password="$APP_PASSWORD" --set=worker_password="$WORKER_PASSWORD" <<'SQL'
CREATE ROLE confsys_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE confsys_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE ROLE confsys_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'worker_password';
CREATE DATABASE confsys OWNER confsys_migrator;
CREATE DATABASE confsys_test OWNER confsys_migrator;
REVOKE ALL ON DATABASE confsys FROM PUBLIC;
REVOKE ALL ON DATABASE confsys_test FROM PUBLIC;
GRANT CONNECT ON DATABASE confsys TO confsys_app, confsys_worker;
GRANT CONNECT ON DATABASE confsys_test TO confsys_app, confsys_worker;
SQL
for database in confsys confsys_test; do
 psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC;'
done
