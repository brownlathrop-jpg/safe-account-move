import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Truck, FilePlus2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/shipments")({
  component: ShipmentsLayout,
});

function ShipmentsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isList = pathname === "/shipments";
  const isNew = pathname === "/shipments/new";

  return (
    <div className="space-y-4">
      {(isList || isNew) && (
        <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
          <Link
            to="/shipments"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isList ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Truck className="h-4 w-4" />
            Список накладных
          </Link>
          <Link
            to="/shipments/new"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isNew ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FilePlus2 className="h-4 w-4" />
            Новая накладная
          </Link>
        </div>
      )}
      <Outlet />
    </div>
  );
}
