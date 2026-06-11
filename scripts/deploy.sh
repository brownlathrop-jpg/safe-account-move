#!/usr/bin/env bash
# Деплой на VPS: билдит проект и заливает dist/ + selfhost/ в /root/crm, рестартует pm2.
# Требует переменные окружения: VPS_SSH_HOST, VPS_SSH_USER и ключ /root/.ssh/vps_key.
set -euo pipefail

SSH_KEY="${SSH_KEY:-/root/.ssh/vps_key}"
SSH_HOST="${VPS_SSH_HOST:?VPS_SSH_HOST not set}"
SSH_USER="${VPS_SSH_USER:?VPS_SSH_USER not set}"
REMOTE_DIR="${REMOTE_DIR:-/root/crm}"
PM2_NAME="${PM2_NAME:-crm}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts -i "$SSH_KEY")

cd "$(dirname "$0")/.."

echo ">>> [1/4] Building production bundle..."
bun run build

if [ ! -f dist/server/index.mjs ]; then
  echo "Build did not produce dist/server/index.mjs"; exit 1
fi

echo ">>> [2/4] Uploading dist/ and selfhost/ to $SSH_USER@$SSH_HOST:$REMOTE_DIR..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "mkdir -p $REMOTE_DIR"
tar -cz dist selfhost | ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" \
  "cd $REMOTE_DIR && rm -rf dist selfhost && tar -xz"

echo ">>> [3/4] Restarting pm2 process '$PM2_NAME'..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "pm2 restart $PM2_NAME --update-env && pm2 save"

echo ">>> [4/4] Verifying..."
ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "pm2 describe $PM2_NAME | grep -E 'status|uptime|restarts'"

echo ">>> Deploy complete."