ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'order',
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_received NUMERIC,
  ADD COLUMN IF NOT EXISTS cash_basis TEXT;

CREATE INDEX IF NOT EXISTS invoices_parent_idx ON public.invoices(parent_id);
CREATE INDEX IF NOT EXISTS invoices_doc_type_idx ON public.invoices(doc_type);
