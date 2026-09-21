-- Fix: permission denied for table invoices
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_statuses TO authenticated;
GRANT ALL ON public.invoice_statuses TO service_role;
