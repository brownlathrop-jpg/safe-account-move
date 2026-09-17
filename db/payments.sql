-- Этап 3: оплаты по документам.
-- data: { invoice_id, partner_id, direction: 'in'|'out', amount, date,
--         method: 'cash'|'bank', cashflow_item_id, note }

CREATE TABLE IF NOT EXISTS invoice_payments (
  id           text PRIMARY KEY,
  workspace_id text,
  user_id      text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_payments_ws_idx ON invoice_payments (workspace_id);
CREATE INDEX IF NOT EXISTS invoice_payments_user_idx ON invoice_payments (user_id);
CREATE INDEX IF NOT EXISTS invoice_payments_data_idx ON invoice_payments USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments ((data->>'invoice_id'));
CREATE INDEX IF NOT EXISTS invoice_payments_partner_idx ON invoice_payments ((data->>'partner_id'));

-- живое обновление на клиентах
DROP TRIGGER IF EXISTS crm_notify ON invoice_payments;
CREATE TRIGGER crm_notify AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION crm_notify_change();
