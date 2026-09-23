import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BarChart3, BookOpen, BookText, Scale } from "lucide-react";
import { useBilling } from "@/hooks/use-billing";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsLayout,
});

function ReportsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { features } = useBilling();
  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
      active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-1 gap-1">
        <Link to="/reports" className={tabClass(pathname === "/reports")}>
          <BarChart3 className="h-4 w-4" />
          Отчёты
        </Link>
        {features.cashbook && (
          <Link to="/reports/book" className={tabClass(pathname === "/reports/book")}>
            <BookOpen className="h-4 w-4" />
            Кассовая книга
          </Link>
        )}
        {features.kudir && (
          <Link to="/reports/kudir" className={tabClass(pathname === "/reports/kudir")}>
            <BookText className="h-4 w-4" />
            КУДиР
          </Link>
        )}
      </div>
      <Outlet />
    </div>
  );
}
