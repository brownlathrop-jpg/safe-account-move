-- Add missing columns used by invoice UI: doc_type, parent_id, cash_received, cash_basis
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'order',
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_received numeric,
  ADD COLUMN IF NOT EXISTS cash_basis text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_doc_type_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_doc_type_check
      CHECK (doc_type IN ('order','shipment','cash_receipt'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_parent_id ON public.invoices(parent_id);
CREATE INDEX IF NOT EXISTS idx_invoices_doc_type ON public.invoices(doc_type);

-- Refresh PostgREST schema cache so the new columns are visible immediately
NOTIFY pgrst, 'reload schema';