#!/usr/bin/env bash
# Деплой CRM на crm.skladnow.ru: сборка, заливка dist/ + selfhost/ + sql/ + scripts/,
# применение миграций базы и перезапуск pm2.
#
# ВНИМАНИЕ: сервер только один — 178.212.13.144 (сайт crm.skladnow.ru, пользователь crmdeploy).
# Переменные VPS_SSH_HOST/VPS_SSH_USER относятся к ДРУГОМУ проекту и здесь не используются.
set -euo pipefail

SSH_KEY="${SSH_KEY:-/tmp/sshkey/id}"
SSH_HOST="${CRM_SSH_HOST:-178.212.13.144}"
SSH_USER="${CRM_SSH_USER:-crmdeploy}"
REMOTE_DIR="${REMOTE_DIR:-/home/crmadmin/htdocs/crm.skladnow.ru}"
PM2_NAME="${PM2_NAME:-crm}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -i "$SSH_KEY")
run() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }

cd "$(dirname "$0")/.."

echo ">>> [1/5] Сборка..."
bun run build
[ -f dist/server/index.mjs ] || { echo "Сборка не создала dist/server/index.mjs"; exit 1; }

echo ">>> [2/5] Заливка в $SSH_USER@$SSH_HOST:$REMOTE_DIR..."
tar -cz dist selfhost sql scripts | run "cd '$REMOTE_DIR' && rm -rf dist.old && { [ -d dist ] && mv dist dist.old; }; rm -rf selfhost sql scripts; tar -xz"

echo ">>> [3/5] Миграции базы..."
run "cd '$REMOTE_DIR' && set -a && . ./.env && set +a && node scripts/migrate.mjs"

echo ">>> [4/5] Перезапуск pm2 '$PM2_NAME'... (через ecosystem, чтобы не потерять .env)"
run "cd '$REMOTE_DIR' && pm2 restart ecosystem.config.cjs && pm2 save"

echo ">>> [5/5] Проверка..."
run "pm2 describe $PM2_NAME | grep -E 'status|uptime|restarts'"
curl -skI --resolve crm.skladnow.ru:443:"$SSH_HOST" https://crm.skladnow.ru/ | head -3

echo ">>> Готово."
