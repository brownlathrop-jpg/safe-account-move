import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Package, FileText, Users, LogOut, Plus, Settings, Warehouse, PanelLeftClose, PanelLeftOpen, Shield, BarChart3, UserCog, Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { db } from "@/integrations/db";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useRealtime } from "@/hooks/use-realtime";

type NavItem = { to: string; label: string; icon: typeof FileText };
type NavGroup = { title: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    title: "Работа",
    items: [
      { to: "/invoices", label: "Документы", icon: FileText },
      { to: "/products", label: "Товары и услуги", icon: Package },
      { to: "/stock", label: "Склад", icon: Warehouse },
      { to: "/partners", label: "Контрагенты", icon: Users },
    ],
  },
  {
    title: "Аналитика",
    items: [
      { to: "/dashboard", label: "Сводка", icon: LayoutDashboard },
      { to: "/reports", label: "Отчёты и учёт", icon: BarChart3 },
    ],
  },
  {
    title: "Управление",
    items: [
      { to: "/team", label: "Сотрудники", icon: UserCog },
      { to: "/settings", label: "Настройки", icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useRealtime();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    db.auth.getUser().then(({ data }) => setIsAdmin(!!(data.user?.user_metadata as any)?.is_admin));
  }, []);
  const navGroups: NavGroup[] = isAdmin
    ? groups.map((g) => (g.title === "Управление"
        ? { ...g, items: [...g.items, { to: "/admin", label: "Админка", icon: Shield }] }
        : g))
    : groups;

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

  // мобильное меню (выдвижное)
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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

  const sidebar = (mobile: boolean) => {
    const narrow = collapsed && !mobile;
    return (
      <>
        <div className={`flex items-center gap-2 border-b ${narrow ? "px-2 py-3 justify-center" : "px-4 py-3"}`}>
          <div className="h-8 w-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">К</div>
          {!narrow && <span className="font-semibold truncate">КабинетCRM</span>}
          {!narrow && !mobile && (
            <Button
              variant="ghost" size="icon" className="ml-auto h-7 w-7"
              onClick={() => setCollapsed(true)} title="Свернуть меню"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        {narrow && (
          <div className="px-1 py-2 flex justify-center border-b">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setCollapsed(false)} title="Развернуть меню"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        )}
        <nav className={`flex-1 overflow-y-auto ${narrow ? "px-1" : "px-2"} py-2 space-y-2`}>
          {navGroups.map((group, gi) => (
            <div key={group.title} className="space-y-0.5">
              {narrow
                ? gi > 0 && <div className="mx-2 my-2 border-t" />
                : (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </div>
                )}
              {group.items.map(({ to, label, icon: Icon }) => {
                const active = pathname === to || pathname.startsWith(to + "/");
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => { flushInvoiceDraft(); setMobileOpen(false); }}
                    title={narrow ? label : undefined}
                    className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${
                      narrow ? "justify-center px-0 py-2" : "px-3 py-2 sm:py-1.5"
                    } ${active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!narrow && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`border-t ${narrow ? "p-1 space-y-1" : "p-2 space-y-1.5"}`}>
          {!narrow && <WorkspaceSwitcher />}
          <Link to="/invoices/new" className="block" onClick={() => { flushInvoiceDraft(); setMobileOpen(false); }}>
            <Button className={`w-full ${narrow ? "px-0" : ""}`} size="sm" title="Новый документ">
              <Plus className="h-4 w-4" />
              {!narrow && <span className="ml-1">Новый документ</span>}
            </Button>
          </Link>
          <Button
            variant="ghost" size="sm"
            className={`w-full ${narrow ? "justify-center px-0" : "justify-start"}`}
            onClick={signOut} title="Выйти"
          >
            <LogOut className="h-4 w-4" />
            {!narrow && <span className="ml-2">Выйти</span>}
          </Button>
        </div>
      </>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={`${collapsed ? "w-14" : "w-60"} hidden md:flex shrink-0 border-r bg-sidebar flex-col h-full transition-[width] duration-150`}
      >
        {sidebar(false)}
      </aside>

      {/* мобильное меню */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-sidebar shadow-xl">
            {sidebar(true)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <Button
            variant="ghost" size="icon" className="md:hidden"
            onClick={() => setMobileOpen(true)} title="Меню"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-semibold md:hidden">КабинетCRM</span>
          <div className="ml-auto">
            <GlobalSearch />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full p-3 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
