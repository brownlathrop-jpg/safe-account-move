import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Minus, PackageSearch, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { priceOf } from "@/lib/price-types";

export type PickerProduct = { id: string; name: string; price: number; cost: number; unit?: string; stock?: number; kind?: "product" | "service"; prices?: Record<string, number> | null };
export type PickedItem = { product_id: string; name: string; quantity: number; price: number; kind: "product" | "service" };

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

export function ProductPicker({
  products, kind, onAdd, disabled, priceTypeId,
}: {
  products: PickerProduct[];
  kind: "outgoing" | "incoming";
  onAdd: (items: PickedItem[]) => void;
  disabled?: boolean;
  priceTypeId?: string | null;
}) {
  const priceFor = (p: PickerProduct) => (kind === "outgoing" ? priceOf(p, priceTypeId) : Number(p.cost ?? 0));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setPicked({});
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? products.filter(p => p.name.toLowerCase().includes(s)) : products;
  }, [q, products]);

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
    if (e.key === "Enter" && filtered.length === 1) {
      toggle(filtered[0].id);
      setQ("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <PackageSearch className="h-4 w-4 mr-1" /> Подбор товаров
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Подбор товаров</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Поиск по названию… (Enter — добавить, если один результат)"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            className="pl-9"
          />
        </div>

        <div className="max-h-[55vh] overflow-auto border rounded-md divide-y">
          {filtered.length === 0 && (
            <div className="text-center text-muted-foreground py-8">Ничего не найдено</div>
          )}
          {filtered.map(p => {
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
