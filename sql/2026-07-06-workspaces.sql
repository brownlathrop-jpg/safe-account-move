-- Мульти-база (workspaces). Запустить один раз в Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own workspaces" ON public.workspaces;
CREATE POLICY "own workspaces" ON public.workspaces FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS workspaces_user_idx ON public.workspaces(user_id);

ALTER TABLE public.partners         ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.products         ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.product_folders  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.invoices         ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.invoice_statuses ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.units            ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.organizations    ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT;

DO $$
DECLARE u uuid; ws uuid;
BEGIN
  FOR u IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.partners
      UNION SELECT user_id FROM public.products
      UNION SELECT user_id FROM public.product_folders
      UNION SELECT user_id FROM public.invoices
      UNION SELECT user_id FROM public.invoice_statuses
      UNION SELECT user_id FROM public.units
      UNION SELECT user_id FROM public.organizations
    ) s WHERE user_id IS NOT NULL
  LOOP
    SELECT id INTO ws FROM public.workspaces WHERE user_id = u ORDER BY created_at LIMIT 1;
    IF ws IS NULL THEN
      INSERT INTO public.workspaces (user_id, name) VALUES (u, 'Тестовая') RETURNING id INTO ws;
    END IF;
    UPDATE public.partners         SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.products         SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.product_folders  SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.invoices         SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.invoice_statuses SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.units            SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
    UPDATE public.organizations    SET workspace_id = ws WHERE user_id = u AND workspace_id IS NULL;
  END LOOP;
END $$;

ALTER TABLE public.partners         ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.products         ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.product_folders  ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoices         ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoice_statuses ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.units            ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.organizations    ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS partners_ws_idx         ON public.partners(workspace_id);
CREATE INDEX IF NOT EXISTS products_ws_idx         ON public.products(workspace_id);
CREATE INDEX IF NOT EXISTS product_folders_ws_idx  ON public.product_folders(workspace_id);
CREATE INDEX IF NOT EXISTS invoices_ws_idx         ON public.invoices(workspace_id);
CREATE INDEX IF NOT EXISTS invoice_statuses_ws_idx ON public.invoice_statuses(workspace_id);
CREATE INDEX IF NOT EXISTS units_ws_idx            ON public.units(workspace_id);
CREATE INDEX IF NOT EXISTS organizations_ws_idx    ON public.organizations(workspace_id);