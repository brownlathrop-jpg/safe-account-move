#!/usr/bin/env bash
# Ночная копия базы CRM: дамп -> шифрование -> выгрузка во внешнее хранилище (S3).
# Работает на любом VPS, настройки берутся из файла окружения — при переезде
# достаточно скопировать этот скрипт и файл настроек.
#
# Установка (под root или под пользователем приложения):
#   cp selfhost/backup-offsite.sh /usr/local/bin/crm-backup-offsite.sh && chmod +x $_
#   cp selfhost/backup.env.example /etc/crm-backup.env   # заполнить значения, chmod 600
#   печатать расписание: crontab -e ->  20 3 * * * /usr/local/bin/crm-backup-offsite.sh >> /var/log/crm-backup-offsite.log 2>&1
set -euo pipefail

ENV_FILE="${CRM_BACKUP_ENV:-/etc/crm-backup.env}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

: "${DATABASE_URL:?DATABASE_URL не задан (в $ENV_FILE или окружении)}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE не задан — пароль шифрования копий}"
: "${S3_BUCKET:?S3_BUCKET не задан}"
S3_PREFIX="${S3_PREFIX:-crm-backups}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/crm}"
KEEP_DAILY="${KEEP_DAILY:-14}"

DAY=$(date +%F)
DOW=$(date +%u)          # 7 = воскресенье
DOM=$(date +%d)
NAME="crm-${DAY}.sql.gz.enc"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo "[$(date -Is)] дамп базы"
pg_dump "$DATABASE_URL" | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  > "$TMP/$NAME"
SIZE=$(stat -c%s "$TMP/$NAME")
[ "$SIZE" -gt 10000 ] || { echo "копия подозрительно мала ($SIZE байт) — прерываю"; exit 1; }

mkdir -p "$LOCAL_DIR"; chmod 700 "$LOCAL_DIR"
cp "$TMP/$NAME" "$LOCAL_DIR/$NAME"; chmod 600 "$LOCAL_DIR/$NAME"
find "$LOCAL_DIR" -name 'crm-*.sql.gz*' -mtime +"$KEEP_DAILY" -delete

upload() { # $1 = путь в бакете
  echo "[$(date -Is)] выгрузка s3://$S3_BUCKET/$1"
  if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && command -v aws >/dev/null; then
    aws s3 cp "$TMP/$NAME" "s3://$S3_BUCKET/$1" --only-show-errors
  elif [ -n "${LOVABLE_API_KEY:-}" ] && [ -n "${AWS_S3_API_KEY:-}" ]; then
    # выгрузка через подписанную ссылку (ключи AWS на сервере не хранятся)
    URL=$(curl -sf -X POST \
      "https://connector-gateway.lovable.dev/api/v1/sign_storage_url?provider=aws_s3&mode=write" \
      -H "Authorization: Bearer $LOVABLE_API_KEY" \
      -H "X-Connection-Api-Key: $AWS_S3_API_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"object_path\":\"$1\"}" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
    [ -n "$URL" ] || { echo "не удалось получить ссылку на загрузку"; return 1; }
    curl -sf -X PUT --upload-file "$TMP/$NAME" "$URL" >/dev/null
  else
    echo "нет настроек хранилища (AWS_ACCESS_KEY_ID или LOVABLE_API_KEY + AWS_S3_API_KEY)"; return 1
  fi
}

upload "$S3_PREFIX/daily/$NAME"
[ "$DOW" = "7" ]  && upload "$S3_PREFIX/weekly/crm-${DAY}.sql.gz.enc"  || true
[ "$DOM" = "01" ] && upload "$S3_PREFIX/monthly/crm-${DAY}.sql.gz.enc" || true

echo "[$(date -Is)] готово, размер $((SIZE/1024)) КБ"

# письмо-отчёт (необязательно): Resend
if [ -n "${REPORT_EMAIL:-}" ] && [ -n "${LOVABLE_API_KEY:-}" ] && [ -n "${RESEND_API_KEY:-}" ]; then
  curl -sf -X POST https://connector-gateway.lovable.dev/resend/emails \
    -H "Authorization: Bearer $LOVABLE_API_KEY" \
    -H "X-Connection-Api-Key: $RESEND_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"from\":\"${REPORT_FROM:-onboarding@resend.dev}\",\"to\":[\"$REPORT_EMAIL\"],\"subject\":\"CRM: копия базы за $DAY\",\"text\":\"Копия создана и выгружена. Размер $((SIZE/1024)) КБ.\"}" >/dev/null || true
fi
