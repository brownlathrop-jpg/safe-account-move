-- Этап 6.1: подготовка к импорту из 1С — колонки внешнего ID
-- Позволяет дозагружать выгрузку без дублей.

ALTER TABLE public.product_folders  ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.products         ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.partners         ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.warehouses       ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.banks            ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.bank_accounts    ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.price_types      ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.product_types    ADD COLUMN IF NOT EXISTS ext_1c_id text;
ALTER TABLE public.cashflow_items   ADD COLUMN IF NOT EXISTS ext_1c_id text;

CREATE UNIQUE INDEX IF NOT EXISTS product_folders_ext_uk  ON public.product_folders  (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_ext_uk         ON public.products         (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partners_ext_uk         ON public.partners         (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_ext_uk       ON public.warehouses       (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS banks_ext_uk            ON public.banks            (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_ext_uk    ON public.bank_accounts    (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS price_types_ext_uk      ON public.price_types      (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_types_ext_uk    ON public.product_types    (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cashflow_items_ext_uk   ON public.cashflow_items   (workspace_id, ext_1c_id) WHERE ext_1c_id IS NOT NULL;
