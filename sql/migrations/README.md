# Версионированные миграции

Каждый файл применяется один раз и записывается в таблицу `schema_migrations`
(вместе с контрольной суммой — правку уже применённого файла скрипт заметит).

Правила:
- имя файла: `YYYYMMDDHHMM_короткое-описание.sql` (порядок — по имени);
- пишите идемпотентно (`if not exists`), чтобы повторный ручной прогон был безопасен;
- уже применённый файл не меняйте — добавляйте новый.

Запуск:

```bash
DATABASE_URL=postgres://... node scripts/migrate.mjs --dry   # показать, что будет применено
DATABASE_URL=postgres://... node scripts/migrate.mjs         # применить
```

При деплое (`scripts/deploy.sh`) папки `sql/` и `scripts/` копируются на сервер,
и миграции применяются автоматически до перезапуска приложения.

## Развёртывание базы с нуля

Порядок обязателен — `db/team.sql` и `db/payments.sql` используют функцию
`crm_notify_change()` из `db/realtime-admin.sql`:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/realtime-admin.sql
psql "$DATABASE_URL" -f db/team.sql
psql "$DATABASE_URL" -f db/payments.sql
node scripts/migrate.mjs
```

Старые ручные скрипты — в `sql/` и `sql/archive-supabase/` (историю не применять).
