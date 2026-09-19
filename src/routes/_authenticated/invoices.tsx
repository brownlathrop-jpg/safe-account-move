import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { FileText, FilePlus2, ChevronDown, Truck, Wallet } from "lucide-react";
import { invoiceDraft } from "@/lib/invoice-draft";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

  // Панель показываем только на журнале и на страницах создания — не на карточке /invoices/$id
  const showTabs = pathname === "/invoices" || pathname === "/invoices/new";
  const isList = pathname === "/invoices";

  return (
    <div className="space-y-4">
      {showTabs && (
        <div className="flex flex-wrap items-center gap-2">
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
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <FilePlus2 className="h-4 w-4 mr-1" />
                Новый документ
                {hasDraft && (
                  <span className="ml-1 inline-flex items-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5 py-0.5 uppercase">
                    черновик
                  </span>
                )}
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild>
                <Link to="/invoices/new"><FileText className="h-4 w-4 mr-2" /> Заявка</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/shipments/new"><Truck className="h-4 w-4 mr-2" /> Накладная или поступление</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/cash/new"><Wallet className="h-4 w-4 mr-2" /> Кассовый ордер (ПКО / РКО)</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Outlet />
    </div>
  );
}
