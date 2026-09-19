#!/usr/bin/env bash
# Восстановление базы CRM из зашифрованной копии.
#   BACKUP_PASSPHRASE=... bash selfhost/restore.sh crm-2026-09-19.sql.gz.enc [имя_базы]
# По умолчанию восстанавливает в проверочную базу crm_restore_test, чтобы
# ничего не испортить. Для реального восстановления укажите имя базы вторым аргументом.
set -euo pipefail

FILE="${1:?укажите файл копии}"
DB="${2:-crm_restore_test}"
: "${BACKUP_PASSPHRASE:?нужен пароль шифрования копий}"
PGURL="${ADMIN_DATABASE_URL:-postgresql://postgres@127.0.0.1:5432/postgres}"

echo "создаю базу $DB"
psql "$PGURL" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\"" -c "create database \"$DB\""

echo "восстанавливаю"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | gunzip | psql "${PGURL%/*}/$DB" -q

echo "проверка: количество строк"
psql "${PGURL%/*}/$DB" -X -c "
  select 'products' t, count(*) from products
  union all select 'partners', count(*) from partners
  union all select 'invoices', count(*) from invoices
  union all select 'invoice_items', count(*) from invoice_items
  union all select 'stock_movements', count(*) from stock_movements;"
echo "готово"
