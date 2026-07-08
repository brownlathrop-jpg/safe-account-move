import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { ensureWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user;
    if (!sessionUser) throw redirect({ to: "/auth" });

    // Гарантируем существование хотя бы одной базы и выбранной активной
    try { await ensureWorkspace(sessionUser.id); } catch {}
    return { user: sessionUser };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
