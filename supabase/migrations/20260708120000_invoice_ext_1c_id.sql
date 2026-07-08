-- Добавляем внешний ID из 1С для документов, чтобы можно было делать upsert при повторном импорте
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ext_1c_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_workspace_ext_1c_id_uidx
  ON public.invoices(workspace_id, ext_1c_id)
  WHERE ext_1c_id IS NOT NULL;
