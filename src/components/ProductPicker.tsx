import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Minus, PackageSearch, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { priceOf } from "@/lib/price-types";
import { db } from "@/integrations/db";

export type PickerProduct = { id: string; name: string; price: number; cost: number; unit?: string; stock?: number; kind?: "product" | "service"; prices?: Record<string, number> | null; folder_id?: string | null };
export type PickedItem = { product_id: string; name: string; quantity: number; price: number; kind: "product" | "service" };
type PickerFolder = { id: string; name: string; parent_id: string | null };

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const ALL = "__all__";

export function ProductPicker({
  products, kind, onAdd, disabled, priceTypeId, workspaceId,
}: {
  products: PickerProduct[];
  kind: "outgoing" | "incoming";
  onAdd: (items: PickedItem[]) => void;
  disabled?: boolean;
  priceTypeId?: string | null;
  workspaceId?: string | null;
}) {
  const priceFor = (p: PickerProduct) => (kind === "outgoing" ? priceOf(p, priceTypeId) : Number(p.cost ?? 0));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [folderId, setFolderId] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: folders = [] } = useQuery({
    queryKey: ["product_folders", workspaceId],
    enabled: open && !!workspaceId,
    queryFn: async () =>
      ((await (db as any).from("product_folders").select("id,name,parent_id").eq("workspace_id", workspaceId).order("name")).data ?? []) as PickerFolder[],
  });

  useEffect(() => {
    if (open) {
      setQ("");
      setPicked({});
      setFolderId(ALL);
      setExpanded({});
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const childMap = useMemo(() => {
    const m = new Map<string | null, PickerFolder[]>();
    for (const f of folders) {
      const arr = m.get(f.parent_id) ?? [];
      arr.push(f);
      m.set(f.parent_id, arr);
    }
    return m;
  }, [folders]);

  // id папки -> все вложенные id (включая саму)
  const folderWithDescendants = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const collect = (id: string): Set<string> => {
      const hit = cache.get(id);
      if (hit) return hit;
      const s = new Set<string>([id]);
      for (const c of childMap.get(id) ?? []) for (const d of collect(c.id)) s.add(d);
      cache.set(id, s);
      return s;
    };
    return collect;
  }, [childMap]);

  const searching = q.trim().length > 0;

  const visible = useMemo(() => {
    if (searching) {
      const s = q.trim().toLowerCase();
      return products.filter(p => p.name.toLowerCase().includes(s));
    }
    if (folderId === ALL) return products;
    const ids = folderWithDescendants(folderId);
    return products.filter(p => p.folder_id && ids.has(p.folder_id));
  }, [q, searching, folderId, products, folderWithDescendants]);

  const toggle = (id: string) => {
    setPicked(prev => {
      const next = { ...prev };
      if (next[id] !== undefined) delete next[id];
      else next[id] = 1;
      return next;
    });
  };

  const setQty = (id: string, qty: number) => {
    setPicked(prev => ({ ...prev, [id]: Math.max(0, qty) }));
  };

  const bump = (id: string, delta: number) => {
    setPicked(prev => {
      const cur = prev[id] ?? 0;
      const nv = Math.max(0, +(cur + delta).toFixed(3));
      if (nv === 0) {
        const n = { ...prev }; delete n[id]; return n;
      }
      return { ...prev, [id]: nv };
    });
  };

  const handleAdd = () => {
    const items: PickedItem[] = Object.entries(picked).map(([pid, qty]) => {
      const p = products.find(x => x.id === pid)!;
      return {
        product_id: p.id, name: p.name, quantity: qty,
        price: priceFor(p),
        kind: (p.kind ?? "product") as "product" | "service",
      };
    });
    onAdd(items);
    setOpen(false);
  };

  const count = Object.keys(picked).length;
  const total = Object.entries(picked).reduce((s, [pid, qty]) => {
    const p = products.find(x => x.id === pid);
    if (!p) return s;
    return s + qty * priceFor(p);
  }, 0);

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && visible.length === 1) {
      toggle(visible[0].id);
      setQ("");
    }
  };

  const renderTree = (parentId: string | null, depth: number): React.ReactNode => {
    return (childMap.get(parentId) ?? []).map(f => {
      const kids = childMap.get(f.id) ?? [];
      const isOpen = !!expanded[f.id];
      const active = folderId === f.id;
      return (
        <div key={f.id}>
          <div
            className={cn(
              "flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer text-sm hover:bg-muted/60",
              active && "bg-primary/10 font-medium"
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
            onClick={() => setFolderId(f.id)}
          >
            {kids.length > 0 ? (
              <button
                type="button"
                className="h-4 w-4 shrink-0 flex items-center justify-center"
                onClick={e => { e.stopPropagation(); setExpanded(prev => ({ ...prev, [f.id]: !isOpen })); }}
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            {active || isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span className="truncate">{f.name}</span>
          </div>
          {isOpen && renderTree(f.id, depth + 1)}
        </div>
      );
    });
  };

  const tree = (
    <div className="w-56 shrink-0 border rounded-md max-h-[55vh] overflow-auto py-1 pr-1">
      <div
        className={cn(
          "flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer text-sm hover:bg-muted/60",
          folderId === ALL && "bg-primary/10 font-medium"
        )}
        onClick={() => setFolderId(ALL)}
      >
        <span className="h-4 w-4 shrink-0" />
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span>Все товары</span>
      </div>
      {renderTree(null, 0)}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <PackageSearch className="h-4 w-4 mr-1" /> Подбор товаров
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Подбор товаров</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Начните вводить название — поиск по всей базе сразу"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 items-start">
          {!searching && tree}
          <div className="flex-1 min-w-0 max-h-[55vh] overflow-auto border rounded-md divide-y">
            {visible.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                {searching ? "Ничего не найдено" : "В этой папке пусто"}
              </div>
            )}
            {visible.map(p => {
              const qty = picked[p.id];
              const isPicked = qty !== undefined;
              const price = priceFor(p);
              return (
                <div
                  key={p.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-qty]")) return;
                    toggle(p.id);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-muted/50 transition-colors",
                    isPicked && "bg-primary/5"
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded-sm border flex items-center justify-center shrink-0",
                    isPicked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
                  )}>
                    {isPicked && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0 truncate">{p.name}</div>
                  <div className="w-20 text-right text-xs text-muted-foreground tabular-nums shrink-0">
                    {Number(p.stock ?? 0)} {p.unit ?? "шт"}
                  </div>
                  <div className="w-24 text-right tabular-nums shrink-0">{fmt.format(price)}</div>
                  {isPicked && (
                    <div data-qty className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => bump(p.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        step="0.001"
                        className="text-center h-6 w-14 px-1 text-sm"
                        value={qty}
                        onChange={e => setQty(p.id, Number(e.target.value))}
                        onFocus={e => e.currentTarget.select()}
                      />
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => bump(p.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {!isPicked && <div className="w-[86px] shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="sm:justify-between items-center gap-2">
          <div className="text-sm">
            <span className="text-muted-foreground">Выбрано: </span>
            <span className="font-medium">{count}</span>
            {count > 0 && <span className="text-muted-foreground"> · на {fmt.format(total)}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={handleAdd} disabled={count === 0}>Добавить</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
