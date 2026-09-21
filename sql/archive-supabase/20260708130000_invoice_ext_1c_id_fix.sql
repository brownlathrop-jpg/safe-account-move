-- Повторно добавляем ext_1c_id и уникальный индекс на invoices.
-- Предыдущий файл миграции ссылался на несуществующий workspace_id и упал —
-- этот вариант работает через user_id и безопасен для повторного запуска.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ext_1c_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_user_ext_1c_id_uidx
  ON public.invoices(user_id, ext_1c_id)
  WHERE ext_1c_id IS NOT NULL;
