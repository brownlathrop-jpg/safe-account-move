import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Package, FileText, Users, LogOut, Plus, Settings, Warehouse, PanelLeftClose, PanelLeftOpen, Truck, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { db } from "@/integrations/db";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

const nav = [
  { to: "/dashboard", label: "Аналитика", icon: LayoutDashboard },
  { to: "/products", label: "Товары и услуги", icon: Package },
  { to: "/stock", label: "Склад", icon: Warehouse },
  { to: "/invoices", label: "Заявки", icon: FileText },
  { to: "/shipments", label: "Накладные", icon: Truck },
  { to: "/cash", label: "Касса и банк", icon: Wallet },
  { to: "/partners", label: "Контрагенты", icon: Users },
  { to: "/settings", label: "Настройки", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("crm:sidebar-collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem("crm:sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
    }
  }, [collapsed]);

  const flushInvoiceDraft = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("crm:flush-invoice-draft"));
  };

  const signOut = async () => {
    if (typeof window !== "undefined" && !window.confirm("Выйти из КабинетCRM?")) return;
    await qc.cancelQueries();
    qc.clear();
    await db.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={`${collapsed ? "w-14" : "w-60"} shrink-0 border-r bg-sidebar flex flex-col h-full transition-[width] duration-150`}
      >
        <div className={`flex items-center gap-2 border-b ${collapsed ? "px-2 py-3 justify-center" : "px-4 py-3"}`}>
          <div className="h-8 w-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">К</div>
          {!collapsed && <span className="font-semibold truncate">КабинетCRM</span>}
          {!collapsed && (
            <Button
              variant="ghost" size="icon" className="ml-auto h-7 w-7"
              onClick={() => setCollapsed(true)} title="Свернуть меню"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        {collapsed && (
          <div className="px-1 py-2 flex justify-center border-b">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setCollapsed(false)} title="Развернуть меню"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        )}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-1" : "px-2"} py-2 space-y-0.5`}>
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                onClick={flushInvoiceDraft}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5"
                } ${active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className={`border-t ${collapsed ? "p-1 space-y-1" : "p-2 space-y-1.5"}`}>
          {!collapsed && <WorkspaceSwitcher />}
          <Link to="/invoices/new" className="block" onClick={flushInvoiceDraft}>
            <Button className={`w-full ${collapsed ? "px-0" : ""}`} size="sm" title="Новая заявка">
              <Plus className="h-4 w-4" />
              {!collapsed && <span className="ml-1">Новая заявка</span>}
            </Button>
          </Link>
          <Button
            variant="ghost" size="sm"
            className={`w-full ${collapsed ? "justify-center px-0" : "justify-start"}`}
            onClick={signOut} title="Выйти"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Выйти</span>}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
