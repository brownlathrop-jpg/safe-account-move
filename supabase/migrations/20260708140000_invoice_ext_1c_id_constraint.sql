-- Меняем частичный уникальный индекс на полноценный UNIQUE-констрейнт,
-- чтобы Supabase мог использовать его в upsert (onConflict).
DROP INDEX IF EXISTS public.invoices_user_ext_1c_id_uidx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_user_ext_1c_id_key'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_user_ext_1c_id_key UNIQUE (user_id, ext_1c_id);
  END IF;
END $$;
