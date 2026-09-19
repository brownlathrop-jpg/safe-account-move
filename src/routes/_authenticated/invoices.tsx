import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { FileText, FilePlus2 } from "lucide-react";
import { invoiceDraft } from "@/lib/invoice-draft";

export const Route = createFileRoute("/_authenticated/invoices")({
  component: InvoicesLayout,
});

function useHasDraft(): boolean {
  return useSyncExternalStore(
    (l) => invoiceDraft.subscribe(l),
    () => invoiceDraft.hasContent(),
    () => false,
  );
}

function InvoicesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hasDraft = useHasDraft();

  // Показываем вкладки только на списке и на "Новой заявке" — не на карточке /invoices/$id
  const showTabs = pathname === "/invoices" || pathname === "/invoices/new";
  const isList = pathname === "/invoices";
  const isNew = pathname === "/invoices/new";

  return (
    <div className="space-y-4">
      {showTabs && (
        <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
          <Link
            to="/invoices"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isList ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-4 w-4" />
            Общий журнал
          </Link>
          <Link
            to="/invoices/new"
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isNew ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FilePlus2 className="h-4 w-4" />
            Новая заявка
            {hasDraft && !isNew && (
              <span className="ml-1 inline-flex items-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5 py-0.5 uppercase">
                черновик
              </span>
            )}
          </Link>
        </div>
      )}
      <Outlet />
    </div>
  );
}
