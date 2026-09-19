#!/usr/bin/env bash
# Защита сервера CRM. Запускать под root на любом VPS (в том числе после переезда):
#   sudo bash selfhost/server-hardening.sh
# Скрипт идемпотентный: повторный запуск ничего не ломает.
set -euo pipefail

say() { echo -e "\n=== $*"; }

if [ "$(id -u)" != "0" ]; then echo "Нужны права root: sudo bash $0"; exit 1; fi

APP_DIR="${APP_DIR:-$(ls -d /home/*/htdocs/* 2>/dev/null | head -1)}"
SSH_PORT="${SSH_PORT:-22}"

say "1. Файрвол: закрываем базу от интернета"
if ! command -v ufw >/dev/null; then apt-get update -qq && apt-get install -y ufw; fi
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow "${SSH_PORT}"/tcp comment 'ssh'
ufw allow 80/tcp  comment 'http'
ufw allow 443/tcp comment 'https'
ufw allow 8443/tcp comment 'CloudPanel'
ufw deny 5432/tcp comment 'PostgreSQL: только локально'
yes | ufw enable >/dev/null
ufw status verbose | head -20

say "2. PostgreSQL слушает только локальный адрес"
PGCONF=$(ls /etc/postgresql/*/main/postgresql.conf 2>/dev/null | head -1)
HBA=$(ls /etc/postgresql/*/main/pg_hba.conf 2>/dev/null | head -1)
if [ -n "$PGCONF" ]; then
  cp -n "$PGCONF" "$PGCONF.bak-$(date +%s)"
  sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PGCONF"
  sed -i "s/^#\?password_encryption.*/password_encryption = scram-sha-256/" "$PGCONF"
  # внешние подключения к базе запрещаем явно
  if [ -n "$HBA" ]; then
    cp -n "$HBA" "$HBA.bak-$(date +%s)"
    sed -i "/^host .* 0\.0\.0\.0\/0/d;/^host .* ::\/0/d" "$HBA"
    grep -q "127.0.0.1/32 *scram-sha-256" "$HBA" || echo "host    all             all             127.0.0.1/32            scram-sha-256" >> "$HBA"
  fi
  systemctl restart postgresql
  ss -ltn | grep 5432 || true
fi

say "3. Вход на сервер: только по ключу, root по ssh запрещён"
SSHD=/etc/ssh/sshd_config.d/99-crm-hardening.conf
mkdir -p /etc/ssh/sshd_config.d
cat > "$SSHD" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 4
EOF
# не отключаем пароль, если ни у кого нет ключа — иначе можно потерять доступ
if ! grep -rqs "ssh-" /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys; then
  echo "ВНИМАНИЕ: ключей не найдено, оставляю вход по паролю включённым"
  rm -f "$SSHD"
else
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

say "4. Fail2ban: подбор пароля к ssh и к базе"
if ! command -v fail2ban-client >/dev/null; then apt-get install -y fail2ban; fi
cat > /etc/fail2ban/jail.d/crm.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
bantime = 1h

[postgresql]
enabled = true
port = 5432
filter = postgresql
logpath = /var/log/postgresql/*.log
maxretry = 5
bantime = 1h
EOF
cat > /etc/fail2ban/filter.d/postgresql.conf <<'EOF'
[Definition]
failregex = .*(password authentication failed for user|no pg_hba.conf entry).*<HOST>.*
            .*<HOST>.*(password authentication failed for user|no pg_hba.conf entry).*
ignoreregex =
EOF
systemctl restart fail2ban
fail2ban-client status || true

say "5. Права на локальные копии базы"
if [ -d /var/backups/crm ]; then chmod 700 /var/backups/crm; chmod 600 /var/backups/crm/* 2>/dev/null || true; fi

say "Готово. Проверьте: приложение работает, сайт открывается."
echo "Каталог приложения: ${APP_DIR:-не определён}"
