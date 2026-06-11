import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackageSearch } from "lucide-react";

export type PickerProduct = { id: string; name: string; price: number; cost: number; unit?: string; stock?: number; kind?: "product" | "service" };
export type PickedItem = { product_id: string; name: string; quantity: number; price: number; kind: "product" | "service" };

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

export function ProductPicker({
  products, kind, onAdd, disabled,
}: {
  products: PickerProduct[];
  kind: "outgoing" | "incoming";
  onAdd: (items: PickedItem[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? products.filter(p => p.name.toLowerCase().includes(s)) : products;
  }, [q, products]);

  const togglePick = (id: string, on: boolean) => {
    setPicked(prev => {
      const next = { ...prev };
      if (on) next[id] = next[id] || 1;
      else delete next[id];
      return next;
    });
  };

  const setQty = (id: string, qty: number) => {
    setPicked(prev => ({ ...prev, [id]: qty }));
  };

  const handleAdd = () => {
    const items: PickedItem[] = Object.entries(picked).map(([pid, qty]) => {
      const p = products.find(x => x.id === pid)!;
      return {
        product_id: p.id, name: p.name, quantity: qty,
        price: kind === "outgoing" ? Number(p.price) : Number(p.cost),
        kind: (p.kind ?? "product") as "product" | "service",
      };
    });
    onAdd(items);
    setPicked({});
    setQ("");
    setOpen(false);
  };

  const count = Object.keys(picked).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <PackageSearch className="h-4 w-4 mr-1" /> Подбор товаров
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Подбор товаров</DialogTitle>
        </DialogHeader>

        <Input placeholder="Поиск по названию…" value={q} onChange={e => setQ(e.target.value)} />

        <div className="max-h-[55vh] overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Наименование</TableHead>
                <TableHead className="w-24 text-right">Остаток</TableHead>
                <TableHead className="w-28 text-right">{kind === "outgoing" ? "Цена" : "Себест."}</TableHead>
                <TableHead className="w-28 text-right">Кол-во</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Ничего не найдено</TableCell></TableRow>
              )}
              {filtered.map(p => {
                const isPicked = picked[p.id] !== undefined;
                return (
                  <TableRow key={p.id} className={isPicked ? "bg-muted/40" : ""}>
                    <TableCell>
                      <Checkbox checked={isPicked} onCheckedChange={(v) => togglePick(p.id, !!v)} />
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{Number(p.stock ?? 0)} {p.unit ?? "шт"}</TableCell>
                    <TableCell className="text-right">{fmt.format(Number(kind === "outgoing" ? p.price : p.cost))}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.001"
                        className="text-right h-8"
                        value={picked[p.id] ?? ""}
                        onChange={e => setQty(p.id, Number(e.target.value))}
                        onFocus={() => { if (!isPicked) togglePick(p.id, true); }}
                        disabled={!isPicked}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="text-sm text-muted-foreground">Выбрано: {count}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={handleAdd} disabled={count === 0}>Добавить в накладную</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
