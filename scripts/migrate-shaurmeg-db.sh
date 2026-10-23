#!/usr/bin/env bash
# Copy the entire Shaurmeg PostgreSQL database with pg_dump/pg_restore.
# Prerequisites: the expired Render database is restored, writes are frozen,
# both DIRECT (unpooled) connection URLs are available, and pg18 tools installed.
# IMPORTANT: This file never changes Render's DATABASE_URL or deletes the source.
set -euo pipefail
umask 077

for var in SOURCE_DATABASE_URL TARGET_DATABASE_URL SHAURMEG_BACKUP_DIR SHAURMEG_WRITES_FROZEN; do
  if [[ ! -v "$var" ]]; then
    echo "Missing required environment variable: $var" >&2
    exit 2
  fi
done
if [[ "$SHAURMEG_WRITES_FROZEN" != "YES" ]]; then
  echo "STOP: freeze all writes to the old database, then set SHAURMEG_WRITES_FROZEN=YES" >&2
  exit 2
fi
if [[ "$SOURCE_DATABASE_URL" == "$TARGET_DATABASE_URL" ]]; then
  echo "STOP: source and destination connection strings are identical" >&2
  exit 2
fi
for bin in pg_dump pg_restore psql; do
  command -v "$bin" >/dev/null || { echo "Missing PostgreSQL tool: $bin" >&2; exit 2; }
done
# This migration is PostgreSQL 18 to PostgreSQL 18. Older pg_dump can't dump PG18.
if ! pg_dump --version | grep -Eq 'PostgreSQL\) 18\.'; then
  echo "STOP: use PostgreSQL 18 pg_dump (matching source server major version)" >&2
  exit 2
fi

psql_source() { psql "$SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
psql_target() { psql "$TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
echo "Checking source and destination identities..."
source_name="$(psql_source -c 'SELECT current_database()')"
target_name="$(psql_target -c 'SELECT current_database()')"
if [[ "$source_name" != "shaurma_city_db" || "$target_name" != "shaurmeg" ]]; then
  echo "STOP: unexpected database names. Source: $source_name; target: $target_name" >&2
  exit 2
fi
source_ver="$(psql_source -c 'SHOW server_version_num')"
target_ver="$(psql_target -c 'SHOW server_version_num')"
if [[ "$source_ver" != 18* || "$target_ver" != 18* ]]; then
  echo "STOP: both servers must use PostgreSQL 18. Source: $source_ver, target: $target_ver" >&2
  exit 2
fi
source_bytes="$(psql_source -c 'SELECT pg_database_size(current_database())')"
echo "Source database size: $source_bytes bytes. Ensure Neon has sufficient paid capacity if >0.5 GB."

schema_sql="SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','m','S')"
target_objects="$(psql_target -c "$schema_sql")"
if [[ "$target_objects" != "0" ]]; then
  echo "STOP: destination contains $target_objects database objects. Never overwrite populated database." >&2
  exit 2
fi
mkdir -p "$SHAURMEG_BACKUP_DIR"
chmod 700 "$SHAURMEG_BACKUP_DIR"
archive="$SHAURMEG_BACKUP_DIR/shaurmeg-full-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [[ -e "$archive" ]]; then echo "STOP: backup path already exists" >&2; exit 2; fi

echo "Dumping all schemas, tables, data, sequences, constraints and large objects..."
pg_dump --format=custom --no-owner --no-acl --file="$archive" "$SOURCE_DATABASE_URL"
pg_restore --list "$archive" >/dev/null
echo "Backup saved: $archive"
echo "Restoring into the EMPTY Neon database in one transaction..."
pg_restore --single-transaction --exit-on-error --no-owner --no-acl --dbname="$TARGET_DATABASE_URL" "$archive"

echo "Comparing every table / materialized view row count..."
table_sql="SELECT format('%I.%I',n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','m') ORDER BY n.nspname,c.relname"
tables="$(psql_source -c "$table_sql")"
if [[ -z "$tables" ]]; then echo "STOP: source contains no tables" >&2; exit 1; fi
table_count=0
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  before="$(psql_source -c "SELECT count(*) FROM $table")"
  after="$(psql_target -c "SELECT count(*) FROM $table")"
  if [[ "$before" != "$after" ]]; then
    echo "FAILED: $table source=$before target=$after" >&2
    exit 1
  fi
  table_count=$((table_count+1))
done <<< "$tables"

source_objects="$(psql_source -c "$schema_sql")"
destination_objects="$(psql_target -c "$schema_sql")"
if [[ "$source_objects" != "$destination_objects" ]]; then
  echo "FAILED: schema object counts differ: source=$source_objects target=$destination_objects" >&2
  exit 1
fi
sequence_sql="SELECT schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename"
source_sequences="$(psql_source -F '|' -c "$sequence_sql")"
target_sequences="$(psql_target -F '|' -c "$sequence_sql")"
if [[ "$source_sequences" != "$target_sequences" ]]; then
  echo "FAILED: sequences differ. STOP cutover until fixed." >&2
  exit 1
fi
echo "PASS: $table_count tables/views, $source_objects schema objects, all sequence values equal."
echo "IMPORTANT: database copied but API NOT switched. Keep original DB untouched."
echo "NEXT: verify sample venue/menu/favorites/orders/RealCity records, configure backups,"
echo "then update only the Shaurmeg API DATABASE_URL and deploy. Retain archive and source for rollback."
