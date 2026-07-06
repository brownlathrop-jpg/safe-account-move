-- Запустите этот SQL в Supabase Dashboard → SQL Editor (один раз).

-- 1) Гранты для products (лечит "permission denied for table products")
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

-- 2) Колонка для фото товара
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3) Публичный bucket для фото товаров
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 4) Политики: читать могут все, загружать/менять — только владелец (первый сегмент пути = auth.uid())
DROP POLICY IF EXISTS "product-images read" ON storage.objects;
CREATE POLICY "product-images read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product-images insert own" ON storage.objects;
CREATE POLICY "product-images insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "product-images update own" ON storage.objects;
CREATE POLICY "product-images update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "product-images delete own" ON storage.objects;
CREATE POLICY "product-images delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);