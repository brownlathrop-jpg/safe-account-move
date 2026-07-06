import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Package, FileText, Users, LogOut, Plus, Settings, Warehouse } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

const nav = [
  { to: "/dashboard", label: "Аналитика", icon: LayoutDashboard },
  { to: "/products", label: "Товары и услуги", icon: Package },
  { to: "/stock", label: "Склад", icon: Warehouse },
  { to: "/invoices", label: "Заявки", icon: FileText },
  { to: "/partners", label: "Контрагенты", icon: Users },
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const flushInvoiceDraft = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("crm:flush-invoice-draft"));
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-60 border-r bg-sidebar flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2 border-b">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">К</div>
          <span className="font-semibold">КабинетCRM</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                onClick={flushInvoiceDraft}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t">
          <div className="mb-2">
            <WorkspaceSwitcher />
          </div>
          <Link to="/invoices/new" className="block mb-2" onClick={flushInvoiceDraft}>
            <Button className="w-full" size="sm"><Plus className="h-4 w-4 mr-1" /> Новая заявка</Button>
          </Link>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Выйти
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
