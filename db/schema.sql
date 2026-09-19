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

CREATE TABLE IF NOT EXISTS app_sessions (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id);

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
