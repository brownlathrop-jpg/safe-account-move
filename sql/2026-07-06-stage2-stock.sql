-- Этап 2: склад — поступления и остатки.
-- Запустить один раз в Supabase → SQL Editor.

-- ============================================================
-- 1. Движения товара
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(18,3) NOT NULL,
  doc_type text NOT NULL,
  doc_id uuid,
  moved_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own stock_movements" ON public.stock_movements;
CREATE POLICY "own stock_movements" ON public.stock_movements FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS stock_movements_ws_idx ON public.stock_movements(workspace_id);
CREATE INDEX IF NOT EXISTS stock_movements_prod_idx ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS stock_movements_wh_idx ON public.stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS stock_movements_doc_idx ON public.stock_movements(doc_type, doc_id);

-- ============================================================
-- 2. Поступления товара
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  number text NOT NULL,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_receipts TO authenticated;
GRANT ALL ON public.stock_receipts TO service_role;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own stock_receipts" ON public.stock_receipts;
CREATE POLICY "own stock_receipts" ON public.stock_receipts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS stock_receipts_ws_idx ON public.stock_receipts(workspace_id);

CREATE TABLE IF NOT EXISTS public.stock_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.stock_receipts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(18,3) NOT NULL CHECK (qty > 0),
  price numeric(18,2) NOT NULL DEFAULT 0,
  sum  numeric(18,2) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_receipt_items TO authenticated;
GRANT ALL ON public.stock_receipt_items TO service_role;
ALTER TABLE public.stock_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own stock_receipt_items" ON public.stock_receipt_items;
CREATE POLICY "own stock_receipt_items" ON public.stock_receipt_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_receipts r WHERE r.id = receipt_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_receipts r WHERE r.id = receipt_id AND r.user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS stock_receipt_items_rid_idx ON public.stock_receipt_items(receipt_id);

-- ============================================================
-- 3. Триггер: строка поступления -> движение товара
-- ============================================================
CREATE OR REPLACE FUNCTION public.tf_stock_receipt_item_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hdr record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT user_id, workspace_id, warehouse_id, receipt_date
      INTO hdr FROM public.stock_receipts WHERE id = NEW.receipt_id;
    INSERT INTO public.stock_movements(user_id, workspace_id, warehouse_id, product_id, qty, doc_type, doc_id, moved_at)
    VALUES (hdr.user_id, hdr.workspace_id, hdr.warehouse_id, NEW.product_id, NEW.qty, 'receipt_item', NEW.id, hdr.receipt_date);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.stock_movements WHERE doc_type = 'receipt_item' AND doc_id = OLD.id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.stock_movements SET qty = NEW.qty, product_id = NEW.product_id
     WHERE doc_type = 'receipt_item' AND doc_id = NEW.id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_stock_receipt_item_movement ON public.stock_receipt_items;
CREATE TRIGGER trg_stock_receipt_item_movement
AFTER INSERT OR UPDATE OR DELETE ON public.stock_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tf_stock_receipt_item_movement();

-- ============================================================
-- 4. Представление остатков
-- ============================================================
CREATE OR REPLACE VIEW public.stock_balances AS
SELECT
  m.workspace_id,
  m.warehouse_id,
  m.product_id,
  SUM(m.qty)::numeric(18,3) AS qty
FROM public.stock_movements m
GROUP BY m.workspace_id, m.warehouse_id, m.product_id;

GRANT SELECT ON public.stock_balances TO authenticated;
GRANT ALL ON public.stock_balances TO service_role;