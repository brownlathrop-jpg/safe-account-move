-- Схема базы CRM на PostgreSQL.
-- Документная модель: каждая таблица хранит id + workspace_id + data (jsonb).
-- Так CRM сохраняет гибкость набора полей, а отчёты пишутся обычным SQL
-- через data->>'поле'.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------ пользователи

CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (lower(email));
-- личные настройки пользователя (например, тип цены по умолчанию)
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
-- признак администратора платформы
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
-- номер версии входов: увеличение отзывает все прежние cookie пользователя
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS app_sessions (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id);

-- попытки входа: защита от подбора пароля
CREATE TABLE IF NOT EXISTS auth_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  ip         text NOT NULL DEFAULT '',
  ok         boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_email_idx ON auth_attempts (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS auth_attempts_ip_idx ON auth_attempts (ip, created_at DESC);

CREATE TABLE IF NOT EXISTS password_resets (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- ------------------------------------------------------------ данные CRM

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspaces','products','product_folders','product_types','partners',
    'invoices','invoice_items','invoice_statuses','warehouses',
    'stock_movements','stock_receipts','stock_receipt_items',
    'cashflow_items','organizations','bank_accounts','banks',
    'price_types','units'
  ] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id           text PRIMARY KEY,
        workspace_id text,
        user_id      text,
        data         jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )$f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (workspace_id)', t || '_ws_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (user_id)', t || '_user_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin (data jsonb_path_ops)', t || '_data_idx', t);
  END LOOP;
END $$;

-- частые связи
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items ((data->>'invoice_id'));
CREATE INDEX IF NOT EXISTS invoice_items_product_idx ON invoice_items ((data->>'product_id'));
CREATE INDEX IF NOT EXISTS invoices_partner_idx ON invoices ((data->>'partner_id'));
CREATE INDEX IF NOT EXISTS invoices_parent_idx ON invoices ((data->>'parent_id'));
CREATE INDEX IF NOT EXISTS products_folder_idx ON products ((data->>'folder_id'));
CREATE INDEX IF NOT EXISTS products_ext_idx ON products ((data->>'ext_1c_id'));
-- один код 1С — одна карточка в базе (защита от дублей при повторном импорте)
CREATE UNIQUE INDEX IF NOT EXISTS products_ext_1c_uniq
  ON products (workspace_id, (data->>'ext_1c_id'))
  WHERE coalesce(data->>'ext_1c_id','') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS partners_ext_1c_uniq
  ON partners (workspace_id, (data->>'ext_1c_id'))
  WHERE coalesce(data->>'ext_1c_id','') <> '';
CREATE INDEX IF NOT EXISTS product_folders_parent_idx ON product_folders ((data->>'parent_id'));
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements ((data->>'product_id'));
CREATE INDEX IF NOT EXISTS stock_movements_doc_idx ON stock_movements ((data->>'doc_id'));
CREATE INDEX IF NOT EXISTS stock_receipt_items_receipt_idx ON stock_receipt_items ((data->>'receipt_id'));

-- Тарифы, оплата доступа и подтверждение почты (см. sql/migrations/202609210040_billing_and_email.sql)
alter table workspaces add column if not exists plan text not null default 'trial';
alter table workspaces add column if not exists paid_until timestamptz;
alter table workspaces add column if not exists suspended boolean not null default false;
alter table app_users add column if not exists email_confirmed_at timestamptz;

create table if not exists workspace_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  amount numeric(14,2) not null default 0,
  months int not null default 1,
  plan text not null default '',
  paid_until timestamptz,
  comment text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists workspace_payments_ws_idx on workspace_payments (workspace_id, created_at desc);

create table if not exists email_confirmations (
  token text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_confirmations_user_idx on email_confirmations (user_id);
