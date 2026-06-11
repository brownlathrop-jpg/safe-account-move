
-- Update timestamp helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- PRODUCTS
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'шт',
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own products" ON public.products FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX products_user_idx ON public.products(user_id);

-- PARTNERS
CREATE TABLE public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('customer','supplier')),
  name TEXT NOT NULL,
  inn TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own partners" ON public.partners FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER partners_updated_at BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX partners_user_idx ON public.partners(user_id);

-- INVOICES
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incoming','outgoing')),
  partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  note TEXT,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own invoices" ON public.invoices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX invoices_user_idx ON public.invoices(user_id);
CREATE INDEX invoices_date_idx ON public.invoices(issue_date);

-- INVOICE ITEMS
CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sum NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own invoice items" ON public.invoice_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.user_id = auth.uid()));
CREATE INDEX invoice_items_invoice_idx ON public.invoice_items(invoice_id);

-- Recalculate invoice total
CREATE OR REPLACE FUNCTION public.recalc_invoice_total()
RETURNS TRIGGER AS $$
DECLARE inv UUID;
BEGIN
  inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  UPDATE public.invoices SET total = COALESCE((SELECT SUM(sum) FROM public.invoice_items WHERE invoice_id = inv), 0)
  WHERE id = inv;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER invoice_items_recalc AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_total();

-- Adjust stock when invoice status changes
CREATE OR REPLACE FUNCTION public.apply_invoice_stock()
RETURNS TRIGGER AS $$
DECLARE sign INT;
BEGIN
  -- only act when transitioning to/from 'posted'
  IF (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN RETURN NEW; END IF;

  -- reverse old effect if it was posted
  IF (TG_OP = 'UPDATE' AND OLD.status = 'posted') THEN
    sign := CASE OLD.kind WHEN 'incoming' THEN -1 ELSE 1 END;
    UPDATE public.products p SET stock = p.stock + sign * ii.quantity
    FROM public.invoice_items ii WHERE ii.invoice_id = OLD.id AND ii.product_id = p.id;
  END IF;

  -- apply new effect if now posted
  IF (NEW.status = 'posted') THEN
    sign := CASE NEW.kind WHEN 'incoming' THEN 1 ELSE -1 END;
    UPDATE public.products p SET stock = p.stock + sign * ii.quantity
    FROM public.invoice_items ii WHERE ii.invoice_id = NEW.id AND ii.product_id = p.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER invoices_stock AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.apply_invoice_stock();
