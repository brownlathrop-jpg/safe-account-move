
CREATE TABLE public.product_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.product_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_folders TO authenticated;
GRANT ALL ON public.product_folders TO service_role;

ALTER TABLE public.product_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own product folders" ON public.product_folders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_product_folders_updated
  BEFORE UPDATE ON public.product_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products
  ADD COLUMN folder_id UUID REFERENCES public.product_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_products_folder ON public.products(folder_id);
