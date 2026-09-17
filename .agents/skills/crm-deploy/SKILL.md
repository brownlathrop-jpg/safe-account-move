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
- pm2 process: `crm`

NEVER deploy to `186.246.48.162` / `delivery.skladnow.ru` — different project. `$VPS_SSH_HOST` and `$VPS_SSH_USER` point there; ignore them. Only `$VPS_SSH_PRIVATE_KEY` is shared with this host.
Do not touch other CloudPanel sites, databases, or vhosts on the server.

## Steps

1. Restore the key if missing:

```bash
mkdir -p /tmp/sshkey && printf '%s\n' "$VPS_SSH_PRIVATE_KEY" \
  | sed 's/\\n/\n/g' > /tmp/sshkey/id && chmod 600 /tmp/sshkey/id
```

If the key is a single line without headers, rebuild it as PEM: header line, 64-char body chunks, footer line.

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
$SSH 'cd /home/crmadmin/htdocs/crm.skladnow.ru && rm -rf dist.old && { [ -d dist ] && mv dist dist.old; }; tar -xzf /tmp/crm.tgz -C .; rm -f /tmp/crm.tgz; pm2 restart crm --update-env && pm2 save'
```

5. Verify — do not report success without this:

```bash
curl -skI --resolve crm.skladnow.ru:443:178.212.13.144 https://crm.skladnow.ru/ | head -20
$SSH 'pm2 describe crm | grep -E "status|uptime|restarts"'
```

Expect `HTTP/2 200` and pm2 status `online`.

## If it fails

- pm2 `errored` → `$SSH 'pm2 logs crm --lines 50 --nostream'`; on a bad build roll back with `mv dist dist.bad && mv dist.old dist && pm2 restart crm`.
- 502 from nginx → node process is down; check pm2 logs and `.env` presence.
- New dependency added → run `npm ci --omit=dev` (or `bun install --production`) in the app dir before restarting.
- Permission errors on the app dir → `crmdeploy` has `NOPASSWD` only for `/usr/bin/clpctl`; use CloudPanel (`panel.skladnow.ru`) rather than widening sudo.
