-- Убираем «мусорные» триггеры/функции, ссылающиеся на несуществующую
-- таблицу public.stock_movements. Они мешают импорту накладных из 1С.
DO $$
DECLARE r RECORD;
BEGIN
  -- 1) Удалить триггеры на invoices / invoice_items, чьи функции упоминают stock_movements
  FOR r IN
    SELECT t.tgname, c.relname AS tbl, p.oid AS func_oid, p.proname AS func_name, n.nspname AS func_schema
    FROM pg_trigger t
    JOIN pg_class   c ON c.oid = t.tgrelid
    JOIN pg_proc    p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE NOT t.tgisinternal
      AND c.relname IN ('invoices','invoice_items')
      AND pg_get_functiondef(p.oid) ILIKE '%stock_movements%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.tgname, r.tbl);
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I() CASCADE', r.func_schema, r.func_name);
  END LOOP;

  -- 2) На всякий случай удалить любые оставшиеся функции public.*, упоминающие stock_movements
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ILIKE '%stock_movements%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
  END LOOP;
END $$;
