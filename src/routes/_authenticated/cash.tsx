import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Wallet, FilePlus2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cash")({
  component: CashLayout,
});

function CashLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isList = pathname === "/cash";
  const isNew = pathname === "/cash/new";

  return (
    <div className="space-y-4">
      {(isList || isNew) && (
        <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
          <Link
            to="/cash"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isList ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Wallet className="h-4 w-4" />
            Касса и банк
          </Link>
          <Link
            to="/cash/new"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isNew ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FilePlus2 className="h-4 w-4" />
            Новый кассовый документ
          </Link>
        </div>
      )}
      <Outlet />
    </div>
  );
}
