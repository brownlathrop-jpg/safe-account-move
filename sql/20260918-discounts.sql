-- Справочник скидок (название + процент или фиксированная сумма).
CREATE TABLE IF NOT EXISTS public.discounts (
  id text PRIMARY KEY,
  workspace_id text,
  user_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discounts_data_idx ON public.discounts USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS discounts_ws_idx ON public.discounts (workspace_id);
CREATE INDEX IF NOT EXISTS discounts_user_idx ON public.discounts (user_id);
DROP TRIGGER IF EXISTS crm_notify ON public.discounts;
CREATE TRIGGER crm_notify AFTER INSERT OR UPDATE OR DELETE ON public.discounts
  FOR EACH ROW EXECUTE FUNCTION crm_notify_change();
