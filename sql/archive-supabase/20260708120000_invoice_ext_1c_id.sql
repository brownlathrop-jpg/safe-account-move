-- Внешний ID из 1С для документов, чтобы делать upsert при повторном импорте.
-- В invoices нет workspace_id — используем user_id (RLS привязан к нему).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ext_1c_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_user_ext_1c_id_uidx
  ON public.invoices(user_id, ext_1c_id)
  WHERE ext_1c_id IS NOT NULL;
