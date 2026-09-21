
CREATE TABLE IF NOT EXISTS public.invoice_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_statuses TO authenticated;
GRANT ALL ON public.invoice_statuses TO service_role;
ALTER TABLE public.invoice_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own invoice statuses" ON public.invoice_statuses FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_invoice_statuses_updated_at BEFORE UPDATE ON public.invoice_statuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES public.invoice_statuses(id) ON DELETE SET NULL;
