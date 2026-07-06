-- Этап 3: списание со склада при проведении расходной накладной
-- (и приходование при приходной накладной).
-- Запустить один раз в Supabase → SQL Editor.

-- 1. У накладной появляется склад
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;

-- 2. Триггер по строкам: если родительская накладная — проведённая shipment,
--    держим движение товара в актуальном виде.
CREATE OR REPLACE FUNCTION public.tf_shipment_item_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hdr record;
        sgn int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.stock_movements WHERE doc_type = 'shipment_item' AND doc_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT user_id, workspace_id, warehouse_id, issue_date, status, doc_type, kind
    INTO hdr FROM public.invoices WHERE id = NEW.invoice_id;

  IF hdr.doc_type <> 'shipment'
     OR hdr.status <> 'posted'
     OR NEW.product_id IS NULL
     OR COALESCE(NEW.kind, 'product') = 'service' THEN
    DELETE FROM public.stock_movements WHERE doc_type = 'shipment_item' AND doc_id = NEW.id;
    RETURN NEW;
  END IF;

  IF hdr.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'В накладной не указан склад';
  END IF;

  sgn := CASE hdr.kind WHEN 'outgoing' THEN -1 ELSE 1 END;

  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE doc_type = 'shipment_item' AND doc_id = NEW.id) THEN
    UPDATE public.stock_movements
       SET qty = sgn * NEW.quantity,
           product_id = NEW.product_id,
           warehouse_id = hdr.warehouse_id,
           moved_at = hdr.issue_date
     WHERE doc_type = 'shipment_item' AND doc_id = NEW.id;
  ELSE
    INSERT INTO public.stock_movements(user_id, workspace_id, warehouse_id, product_id, qty, doc_type, doc_id, moved_at)
    VALUES (hdr.user_id, hdr.workspace_id, hdr.warehouse_id, NEW.product_id, sgn * NEW.quantity, 'shipment_item', NEW.id, hdr.issue_date);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shipment_item_movement ON public.invoice_items;
CREATE TRIGGER trg_shipment_item_movement
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.tf_shipment_item_movement();

-- 3. Триггер по накладной: при смене статуса/склада/типа — пересобрать движения.
CREATE OR REPLACE FUNCTION public.tf_shipment_movement_resync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sgn int;
BEGIN
  IF NEW.doc_type <> 'shipment' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = NEW.status
     AND OLD.warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id
     AND OLD.kind = NEW.kind
     AND OLD.issue_date = NEW.issue_date THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.stock_movements
   WHERE doc_type = 'shipment_item'
     AND doc_id IN (SELECT id FROM public.invoice_items WHERE invoice_id = NEW.id);

  IF NEW.status = 'posted' THEN
    IF NEW.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'В накладной не указан склад';
    END IF;
    sgn := CASE NEW.kind WHEN 'outgoing' THEN -1 ELSE 1 END;
    INSERT INTO public.stock_movements(user_id, workspace_id, warehouse_id, product_id, qty, doc_type, doc_id, moved_at)
    SELECT NEW.user_id, NEW.workspace_id, NEW.warehouse_id, it.product_id, sgn * it.quantity, 'shipment_item', it.id, NEW.issue_date
      FROM public.invoice_items it
     WHERE it.invoice_id = NEW.id
       AND it.product_id IS NOT NULL
       AND COALESCE(it.kind, 'product') <> 'service';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shipment_movement_resync ON public.invoices;
CREATE TRIGGER trg_shipment_movement_resync
AFTER INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tf_shipment_movement_resync();
