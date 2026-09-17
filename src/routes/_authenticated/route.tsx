import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { db } from "@/integrations/firebase/db";
import { AppShell } from "@/components/AppShell";
import { ensureWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await db.auth.getSession();
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
