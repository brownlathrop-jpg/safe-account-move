---
name: crm-deploy
description: Build and deploy this CRM (crm.skladnow.ru) to its own VPS 178.212.13.144 over SSH as user crmdeploy, restart pm2 process "crm", and verify. Use whenever the user says "деплой", "залей", "обнови на сервере" for this project.
---

# CRM deploy (crm.skladnow.ru)

Do it yourself end to end. Never hand the user shell commands.

## Target (the only correct one)

- Host: `178.212.13.144` (CloudPanel site `crm.skladnow.ru`, site user `crmadmin`)
- SSH user: `crmdeploy`, key at `/tmp/sshkey/id`
- App dir: `/home/crmadmin/htdocs/crm.skladnow.ru/` — contains `dist/`, `node-server.js`, `.env`, `node_modules`, `ecosystem.config.cjs`
- pm2 process: `crm`, node listens on port `3001`; nginx (CloudPanel vhost) proxies https://crm.skladnow.ru to `127.0.0.1:3001`

### НИКОГДА не распаковывать в домашнюю папку `crmdeploy`

`ssh crmdeploy@...` логинится в `/home/crmdeploy`, а сайт работает из
`/home/crmadmin/htdocs/crm.skladnow.ru` (доступна как `~/htdocs/crm.skladnow.ru`).
Если распаковать архив без `cd`, появится `/home/crmdeploy/dist` — pm2 перезапустится,
сайт ответит 200, но пользователь не увидит изменений (это уже случалось 18.09.2026).

Every remote command MUST start with `cd /home/crmadmin/htdocs/crm.skladnow.ru &&`.
После деплоя обязательно проверить, что новый чанк реально отдаётся сайтом (см. шаг 5),
и что в `/home/crmdeploy/` нет папки `dist` (если есть — удалить, это мусор).

NEVER deploy to `186.246.48.162` / `delivery.skladnow.ru` — different project. `$VPS_SSH_HOST` and `$VPS_SSH_USER` point there; ignore them. Only `$VPS_SSH_PRIVATE_KEY` is shared with this host.
Do not touch other CloudPanel sites, databases, or vhosts on the server.

## Steps

1. Restore the key if missing. The secret stores the PEM with spaces/literal `\n` instead of newlines — always rebuild it with Python (the `sed` one-liner does NOT work, ssh fails with "error in libcrypto"):

```bash
python3 - <<'EOF'
import os, re
raw = os.environ["VPS_SSH_PRIVATE_KEY"].replace("\\n", "\n")
m = re.search(r"-----BEGIN OPENSSH PRIVATE KEY-----(.*?)-----END OPENSSH PRIVATE KEY-----", raw, re.S)
body = re.sub(r"\s+", "", m.group(1))
lines = ["-----BEGIN OPENSSH PRIVATE KEY-----"] + [body[i:i+64] for i in range(0, len(body), 64)] + ["-----END OPENSSH PRIVATE KEY-----"]
open("/tmp/sshkey/id", "w").write("\n".join(lines) + "\n")
EOF
chmod 600 /tmp/sshkey/id && ssh-keygen -y -f /tmp/sshkey/id > /dev/null && echo KEY_OK
```

If `ssh`/`scp` are missing in the sandbox: `nix profile install nixpkgs#openssh`, then `export PATH="$PATH:/nix/var/nix/profiles/default/bin"`.

2. Build: `bun run build` (must produce `dist/`; also check `dist/server/index.mjs`).

3. Package:

```bash
rm -rf /tmp/deploy && mkdir -p /tmp/deploy \
  && cp -r dist /tmp/deploy/ && cp selfhost/node-server.js /tmp/deploy/ \
  && (cd /tmp/deploy && tar -czf /tmp/crm.tgz dist node-server.js)
```

4. Upload and swap (keeps previous build as `dist.old`):

```bash
SSH="ssh -i /tmp/sshkey/id -o StrictHostKeyChecking=accept-new crmdeploy@178.212.13.144"
scp -i /tmp/sshkey/id -o StrictHostKeyChecking=accept-new /tmp/crm.tgz crmdeploy@178.212.13.144:/tmp/
$SSH 'cd /home/crmadmin/htdocs/crm.skladnow.ru && rm -rf dist.old && { [ -d dist ] && mv dist dist.old; }; tar -xzf /tmp/crm.tgz -C .; rm -f /tmp/crm.tgz; pm2 restart ecosystem.config.cjs && pm2 save   # НЕ `pm2 restart crm --update-env` — это стирает переменные из .env'
```

5. Verify — do not report success without this. HTTP 200 сам по себе НЕ доказывает,
   что залилась новая версия: проверь, что свежий чанк лежит в папке сайта и отдаётся по HTTP.

```bash
curl -skI --resolve crm.skladnow.ru:443:178.212.13.144 https://crm.skladnow.ru/ | head -20
$SSH 'pm2 describe crm | grep -E "status|uptime|restarts"'
$SSH 'ls -la /home/crmadmin/htdocs/crm.skladnow.ru/dist; ls /home/crmdeploy/dist 2>/dev/null && echo "ВНИМАНИЕ: мусорный dist в домашней папке"'
# новый чанк изменённого маршрута действительно отдаётся:
CHUNK=$($SSH 'ls /home/crmadmin/htdocs/crm.skladnow.ru/dist/client/assets | grep <route>')
curl -s https://crm.skladnow.ru/assets/$CHUNK | grep -c "<строка из твоих правок>"
```

Expect `HTTP/2 200`, pm2 status `online`, свежую дату у `dist/` и `grep -c` > 0.


## If it fails

- pm2 `errored` → `$SSH 'pm2 logs crm --lines 50 --nostream'`; on a bad build roll back with `mv dist dist.bad && mv dist.old dist && pm2 restart crm`.
- 502 from nginx → node process is down or not on port 3001; check `$SSH 'curl -sI http://127.0.0.1:3001/'`, pm2 logs and `.env` presence (`PORT=3001`).
- New dependency added → run `npm ci --omit=dev` (or `bun install --production`) in the app dir before restarting.
- Permission errors on the app dir → `crmdeploy` has `NOPASSWD` only for `/usr/bin/clpctl`; use CloudPanel (`panel.skladnow.ru`) rather than widening sudo.

## Важно (сентябрь 2026)

- Перезапуск только через `pm2 restart ecosystem.config.cjs` (он подгружает `.env` через dotenv).
  `pm2 restart crm --update-env` затирает окружение → ошибка «DATABASE_URL не задан».
- `.env` должен быть читаем группой: `chmod 640 .env` (владелец crmadmin, группа crmadmin, crmdeploy в ней).
- Если `dist.old` создавался под root — распаковывать под root и затем `chown -R crmadmin:crmadmin dist dist.old`.
- Драйвер PostgreSQL: в `vite.config.ts` алиас `postgres` → `node_modules/postgres/src/index.js`,
  иначе cloudflare-сборка тянет `cloudflare:sockets` и на Node вход падает с ошибкой ESM-загрузчика.
