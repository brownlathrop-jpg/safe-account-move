-- Этап 1-2: ручные накладные/кассовые документы + проведение накладных по складу.
-- Запустить один раз в Supabase → SQL Editor.

-- ============================================================
-- 1. Новые поля документов
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cashflow_item_id uuid REFERENCES public.cashflow_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_total numeric(18,2);

CREATE INDEX IF NOT EXISTS idx_invoices_cashflow_item ON public.invoices(cashflow_item_id);

-- ============================================================
-- 2. Проведение накладной -> движения по складу
--    Продажа (outgoing) списывает, закупка (incoming) приходует.
--    Услуги и позиции без товара не двигают склад.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_shipment_stock(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hdr record;
BEGIN
  SELECT id, user_id, workspace_id, warehouse_id, kind, status, doc_type, issue_date
    INTO hdr FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.stock_movements WHERE doc_type = 'shipment' AND doc_id = p_invoice;

  IF hdr.doc_type <> 'shipment' OR hdr.status <> 'posted' THEN
    RETURN;
  END IF;

  IF hdr.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Нельзя провести накладную без склада';
  END IF;

  INSERT INTO public.stock_movements(user_id, workspace_id, warehouse_id, product_id, qty, doc_type, doc_id, moved_at)
  SELECT hdr.user_id, hdr.workspace_id, hdr.warehouse_id, it.product_id,
         CASE WHEN hdr.kind = 'outgoing' THEN -it.quantity ELSE it.quantity END,
         'shipment', hdr.id, hdr.issue_date
    FROM public.invoice_items it
    JOIN public.products p ON p.id = it.product_id
   WHERE it.invoice_id = hdr.id
     AND it.product_id IS NOT NULL
     AND COALESCE(p.is_service, false) = false
     AND COALESCE(it.kind, 'product') <> 'service'
     AND it.quantity <> 0;

  UPDATE public.invoices
     SET posted_at = COALESCE(posted_at, now()),
         cost_total = (
           SELECT COALESCE(SUM(it.quantity * COALESCE(p.cost, 0)), 0)
             FROM public.invoice_items it
             LEFT JOIN public.products p ON p.id = it.product_id
            WHERE it.invoice_id = hdr.id
         )
   WHERE id = hdr.id;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_shipment_stock(uuid) TO authenticated, service_role;

-- Триггер на самом документе
CREATE OR REPLACE FUNCTION public.tf_invoice_posting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.stock_movements WHERE doc_type = 'shipment' AND doc_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.doc_type = 'shipment' AND NEW.status <> 'posted' THEN
    UPDATE public.invoices SET posted_at = NULL WHERE id = NEW.id AND posted_at IS NOT NULL;
  END IF;

  PERFORM public.apply_shipment_stock(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_posting ON public.invoices;
CREATE TRIGGER trg_invoice_posting
AFTER INSERT OR UPDATE OF status, warehouse_id, kind, issue_date, doc_type OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tf_invoice_posting();

-- Триггер на строках: правка проведённой накладной пересчитывает движения
CREATE OR REPLACE FUNCTION public.tf_invoice_item_posting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.apply_shipment_stock(OLD.invoice_id);
    RETURN OLD;
  END IF;
  PERFORM public.apply_shipment_stock(NEW.invoice_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_item_posting ON public.invoice_items;
CREATE TRIGGER trg_invoice_item_posting
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.tf_invoice_item_posting();

-- ============================================================
-- 3. Обновляем кэш схемы PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
