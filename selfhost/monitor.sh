#!/usr/bin/env bash
# Ежедневный контроль CRM: свежесть ночной копии, свободное место, доступность сайта.
# Результат приходит письмом через Resend. Переносится на любой VPS без изменений:
# ключ почты и адрес базы берутся из .env приложения, путь к копиям — параметром.
#
# Установка:  bash monitor.sh           — разовая проверка
# Расписание: 0 8 * * * /путь/к/monitor.sh >> /var/log/crm-monitor.log 2>&1
set -u

APP_DIR="${APP_DIR:-/home/crmadmin/htdocs/crm.skladnow.ru}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/crm}"
SITE_URL="${SITE_URL:-https://crm.skladnow.ru}"
MAIL_TO="${MAIL_TO:-dir@doormail.ru}"
MIN_FREE_PCT="${MIN_FREE_PCT:-15}"   # тревога, если свободно меньше %

ENV_FILE="$APP_DIR/.env"
RESEND_API_KEY="$(grep '^RESEND_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
MAIL_FROM="CRM Monitor <noreply@skladnow.ru>"

problems=()
notes=()

# 1. Свежая копия базы (не старше 26 часов)
last_backup="$(ls -1t "$BACKUP_DIR"/crm-*.sql.gz 2>/dev/null | head -1)"
if [ -z "$last_backup" ]; then
  problems+=("Ночная копия базы НЕ НАЙДЕНА в $BACKUP_DIR")
else
  btime="$(stat -c %Y "$last_backup")"
  age_h=$(( ($(date +%s) - btime) / 3600 ))
  bsize="$(du -h "$last_backup" | cut -f1)"
  notes+=("Последняя копия: $(basename "$last_backup") (${bsize}, ${age_h} ч назад)")
  [ "$age_h" -gt 26 ] && problems+=("Копия базы УСТАРЕЛА: ${age_h} ч назад")
fi

# 2. Свободное место на диске
free_pct="$(df / | awk 'NR==2 {print 100-$5+0}')"
notes+=("Свободно на диске: ${free_pct}%")
[ "$free_pct" -lt "$MIN_FREE_PCT" ] && problems+=("На диске мало места: свободно ${free_pct}%")

# 3. Сайт отвечает
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL" || echo 000)"
notes+=("Сайт $SITE_URL отвечает: HTTP $code")
[ "$code" != "200" ] && problems+=("Сайт НЕДОСТУПЕН: HTTP $code")

# 4. Процесс приложения
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe crm >/dev/null 2>&1 && notes+=("Процесс crm: online") || problems+=("Процесс crm НЕ ЗАПУЩЕН (pm2)")
fi

subject="CRM: всё в порядке ($(date +%d.%m.%Y))"
[ ${#problems[@]} -gt 0 ] && subject="CRM: ТРЕБУЕТ ВНИМАНИЯ ($(date +%d.%m.%Y))"

body="Отчёт за $(date '+%d.%m.%Y %H:%M')\n\n"
for p in "${problems[@]:-}"; do [ -n "$p" ] && body="${body}ПРОБЛЕМА: $p\n"; done
for n in "${notes[@]:-}"; do [ -n "$n" ] && body="${body}OK: $n\n"; done

printf '%b' "$body"

if [ -n "$RESEND_API_KEY" ]; then
  curl -s --max-time 20 https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"$MAIL_FROM\",\"to\":[\"$MAIL_TO\"],\"subject\":\"$subject\",\"text\":\"$(printf '%b' "$body" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')\"}" \
    >/dev/null && echo "Письмо отправлено на $MAIL_TO" || echo "Не удалось отправить письмо"
else
  echo "RESEND_API_KEY не найден в $ENV_FILE — письмо не отправлено"
fi

[ ${#problems[@]} -gt 0 ] && exit 1 || exit 0
