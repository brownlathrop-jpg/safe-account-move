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
- 502 from nginx → node process is down or not on port 3001; check `$SSH 'curl -sI http://127.0.0.1:3001/'`, pm2 logs and `.env` presence (`PORT=3001`).
- New dependency added → run `npm ci --omit=dev` (or `bun install --production`) in the app dir before restarting.
- Permission errors on the app dir → `crmdeploy` has `NOPASSWD` only for `/usr/bin/clpctl`; use CloudPanel (`panel.skladnow.ru`) rather than widening sudo.
