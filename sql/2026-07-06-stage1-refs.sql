-- Этап 1: доп. справочники и расширение существующих.
-- Запустить один раз в Supabase → SQL Editor.

-- ============================================================
-- 1. Расширяем контрагентов и организацию
-- ============================================================
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS kpp text,
  ADD COLUMN IF NOT EXISTS okpo text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS entity_type text CHECK (entity_type IN ('legal','individual','entrepreneur')),
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comment text;

-- организация уже имеет банк-реквизиты, добавим только окпо/огрн если вдруг нет
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS comment text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_rate text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS product_type_id uuid;

-- ============================================================
-- 2. Виды номенклатуры (Товары / Услуги / Материалы …)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  is_service boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_types TO authenticated;
GRANT ALL ON public.product_types TO service_role;
ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own product_types" ON public.product_types;
CREATE POLICY "own product_types" ON public.product_types FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS product_types_ws_idx ON public.product_types(workspace_id);

ALTER TABLE public.products
  ADD CONSTRAINT products_product_type_fk
  FOREIGN KEY (product_type_id) REFERENCES public.product_types(id) ON DELETE SET NULL;

-- ============================================================
-- 3. Склады
-- ============================================================
CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  address text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own warehouses" ON public.warehouses;
CREATE POLICY "own warehouses" ON public.warehouses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS warehouses_ws_idx ON public.warehouses(workspace_id);

-- ============================================================
-- 4. Банки и банковские счета
-- ============================================================
CREATE TABLE IF NOT EXISTS public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  bik text NOT NULL,
  name text NOT NULL,
  corr_account text,
  city text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, bik)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banks TO authenticated;
GRANT ALL ON public.banks TO service_role;
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own banks" ON public.banks;
CREATE POLICY "own banks" ON public.banks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS banks_ws_idx ON public.banks(workspace_id);

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  owner_type text NOT NULL CHECK (owner_type IN ('partner','organization')),
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_id uuid REFERENCES public.banks(id) ON DELETE RESTRICT,
  account_number text NOT NULL,
  currency text NOT NULL DEFAULT 'RUB',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (owner_type = 'partner' AND partner_id IS NOT NULL AND organization_id IS NULL) OR
    (owner_type = 'organization' AND organization_id IS NOT NULL AND partner_id IS NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own bank_accounts" ON public.bank_accounts;
CREATE POLICY "own bank_accounts" ON public.bank_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS bank_accounts_ws_idx      ON public.bank_accounts(workspace_id);
CREATE INDEX IF NOT EXISTS bank_accounts_partner_idx ON public.bank_accounts(partner_id);
CREATE INDEX IF NOT EXISTS bank_accounts_org_idx     ON public.bank_accounts(organization_id);

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS primary_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS primary_bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

-- ============================================================
-- 5. Типы цен и цены товаров
-- ============================================================
CREATE TABLE IF NOT EXISTS public.price_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'RUB',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_types TO authenticated;
GRANT ALL ON public.price_types TO service_role;
ALTER TABLE public.price_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own price_types" ON public.price_types;
CREATE POLICY "own price_types" ON public.price_types FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS price_types_ws_idx ON public.price_types(workspace_id);

CREATE TABLE IF NOT EXISTS public.product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_type_id uuid NOT NULL REFERENCES public.price_types(id) ON DELETE CASCADE,
  price numeric(18,2) NOT NULL DEFAULT 0,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_prices TO authenticated;
GRANT ALL ON public.product_prices TO service_role;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own product_prices" ON public.product_prices;
CREATE POLICY "own product_prices" ON public.product_prices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS product_prices_ws_idx      ON public.product_prices(workspace_id);
CREATE INDEX IF NOT EXISTS product_prices_product_idx ON public.product_prices(product_id);
CREATE INDEX IF NOT EXISTS product_prices_type_idx    ON public.product_prices(price_type_id);

-- ============================================================
-- 6. Статьи движения денежных средств
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cashflow_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  direction text NOT NULL DEFAULT 'both' CHECK (direction IN ('in','out','both')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_items TO authenticated;
GRANT ALL ON public.cashflow_items TO service_role;
ALTER TABLE public.cashflow_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own cashflow_items" ON public.cashflow_items;
CREATE POLICY "own cashflow_items" ON public.cashflow_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS cashflow_items_ws_idx ON public.cashflow_items(workspace_id);

-- ============================================================
-- 7. Автозаполнение для существующих баз: базовые записи
-- ============================================================
DO $$
DECLARE ws record;
BEGIN
  FOR ws IN SELECT id, user_id FROM public.workspaces LOOP
    -- склад по умолчанию
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE workspace_id = ws.id) THEN
      INSERT INTO public.warehouses (user_id, workspace_id, name, is_default)
      VALUES (ws.user_id, ws.id, 'Основной склад', true);
    END IF;
    -- виды номенклатуры
    IF NOT EXISTS (SELECT 1 FROM public.product_types WHERE workspace_id = ws.id) THEN
      INSERT INTO public.product_types (user_id, workspace_id, name, is_service) VALUES
        (ws.user_id, ws.id, 'Товары', false),
        (ws.user_id, ws.id, 'Услуги', true),
        (ws.user_id, ws.id, 'Материалы', false);
    END IF;
    -- типы цен
    IF NOT EXISTS (SELECT 1 FROM public.price_types WHERE workspace_id = ws.id) THEN
      INSERT INTO public.price_types (user_id, workspace_id, name, is_default) VALUES
        (ws.user_id, ws.id, 'Розничная', true),
        (ws.user_id, ws.id, 'Оптовая',  false);
    END IF;
    -- статьи ДДС
    IF NOT EXISTS (SELECT 1 FROM public.cashflow_items WHERE workspace_id = ws.id) THEN
      INSERT INTO public.cashflow_items (user_id, workspace_id, name, direction) VALUES
        (ws.user_id, ws.id, 'Оплата от покупателя', 'in'),
        (ws.user_id, ws.id, 'Оплата поставщику',    'out'),
        (ws.user_id, ws.id, 'Прочие поступления',   'in'),
        (ws.user_id, ws.id, 'Прочие расходы',       'out');
    END IF;
  END LOOP;
END $$;