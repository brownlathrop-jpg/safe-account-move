import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type SimpleProduct = { id: string; name: string };

export function ProductPickerSingle({
  open, onOpenChange, products, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: SimpleProduct[];
  onPick: (productId: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? products.filter(p => p.name.toLowerCase().includes(s)) : products;
  }, [q, products]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQ(""); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Выбор товара</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Поиск…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="max-h-[55vh] overflow-auto border rounded-md divide-y">
          {filtered.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">Ничего не найдено</div>
          )}
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors text-sm"
              onClick={() => { onPick(p.id); onOpenChange(false); setQ(""); }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
