# Перенос проекта на другой аккаунт

## Что в архиве
- Весь исходный код (`src/`, `selfhost/`, конфиги).
- Миграции БД: `supabase/migrations/*.sql` — полностью описывают схему (таблицы, RLS, политики, GRANT'ы).
- `package.json` / `bun.lockb` отсутствует — после распаковки выполните `bun install`.

## Шаги переноса

### 1. Распаковать и установить зависимости
```bash
unzip project-export.zip -d my-project
cd my-project
bun install
```

### 2. Создать новый Supabase-проект
1. Зайдите на https://supabase.com/dashboard → **New project**.
2. Запишите:
   - Project URL (`https://xxxxx.supabase.co`)
   - `anon` / `publishable` ключ (Settings → API)
   - `service_role` ключ (только для сервера, секрет)

### 3. Применить схему БД
Вариант A — через Supabase CLI (рекомендуется):
```bash
npx supabase link --project-ref <НОВЫЙ_PROJECT_REF>
npx supabase db push
```
Вариант B — вручную: откройте Supabase Dashboard → SQL Editor и выполните файлы из `supabase/migrations/` **строго по порядку имён** (по timestamp в начале).

### 4. Обновить переменные окружения
В `.env`:
```
VITE_SUPABASE_URL=https://<НОВЫЙ>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<новый publishable key>
```
В `supabase/config.toml` поменяйте `project_id` на новый ref.

Для серверной части (если используется self-host через `selfhost/node-server.js`) — задайте переменные окружения:
```
SUPABASE_URL=https://<НОВЫЙ>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<тот же publishable>
SUPABASE_SERVICE_ROLE_KEY=<service role>
```

### 5. Перенести данные (опционально)
В старом Supabase: Table Editor → каждая таблица → **Export → CSV**.
В новом: Table Editor → **Import data from CSV**.

Порядок импорта важен из-за внешних ключей:
1. `organizations`, `units`, `invoice_statuses`, `partners`, `product_folders`
2. `products`
3. `invoices`
4. `invoice_items`

⚠️ `user_id` в строках ссылается на `auth.users`. После создания новых пользователей в новом проекте обновите `user_id` в CSV на новые UUID, иначе записи не будут видны через RLS.

### 6. Пользователи / Auth
Пользователей `auth.users` напрямую перенести нельзя (хэши паролей шифруются ключом проекта). Варианты:
- Пригласить пользователей заново через Dashboard → Authentication → Users → **Invite**.
- Либо использовать Supabase Auth Admin API для импорта (см. их docs про `auth.admin.createUser`).

### 7. Запуск
```bash
bun run dev
```
Проверьте логин и что данные подгружаются.

## Чек-лист
- [ ] `bun install` прошёл без ошибок
- [ ] Все миграции применились
- [ ] `.env` обновлён
- [ ] Логин работает
- [ ] Списки накладных / товаров / контрагентов открываются
