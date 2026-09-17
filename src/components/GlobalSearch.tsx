// Общий поиск по базе: Ctrl+K или кнопка в верхней панели.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Package, Users, FileText, Truck, Loader2 } from "lucide-react";
import { searchAll } from "@/lib/search.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const ICONS = { product: Package, partner: Users, invoice: FileText, shipment: Truck } as const;
const GROUP: Record<string, string> = {
  product: "Товары и услуги",
  partner: "Контрагенты",
  invoice: "Заявки",
  shipment: "Накладные",
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();
  const run = useServerFn(searchAll);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "л" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["global-search", debounced, wsId],
    enabled: open && debounced.trim().length >= 2,
    queryFn: () => run({ data: { q: debounced, workspaceId: wsId ?? null } }),
    staleTime: 30_000,
  });

  const go = (hit: { type: string; id: string }) => {
    setOpen(false);
    setQ("");
    if (hit.type === "product") navigate({ to: "/products" });
    else if (hit.type === "partner") navigate({ to: "/partner/$id", params: { id: hit.id } });
    else navigate({ to: "/invoices/$id", params: { id: hit.id } });
  };

  const groups = ["product", "partner", "invoice", "shipment"].filter((t) => hits.some((h: any) => h.type === t));

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="justify-start gap-2 text-muted-foreground sm:w-64"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Поиск по базе</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0 gap-0">
          <DialogTitle className="sr-only">Поиск по базе</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Товар, контрагент, номер документа…"
              className="border-0 shadow-none focus-visible:ring-0 px-0"
            />
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {debounced.trim().length < 2 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Введите хотя бы два символа</p>
            )}
            {debounced.trim().length >= 2 && !isFetching && hits.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Ничего не нашлось</p>
            )}
            {groups.map((type) => (
              <div key={type} className="mb-2">
                <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{GROUP[type]}</div>
                {hits.filter((h: any) => h.type === type).map((h: any) => {
                  const Icon = ICONS[h.type as keyof typeof ICONS] ?? Search;
                  return (
                    <button
                      key={`${h.type}-${h.id}`}
                      onClick={() => go(h)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{h.title}</span>
                        {h.subtitle && <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
