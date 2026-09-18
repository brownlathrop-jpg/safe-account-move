import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { fetchBalances } from "@/lib/stock";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";
import { costsAll, costsRecalc } from "@/lib/cost.functions";

export const Route = createFileRoute("/_authenticated/stock")({
  head: () => ({ meta: [{ title: "Склад — КабинетCRM" }] }),
  component: StockPage,
});

const fmtQty = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const fmtMoney = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

type Warehouse = { id: string; name: string; is_default: boolean };
type Product = { id: string; name: string; unit: string | null; cost: number | null; price: number | null; kind?: string | null };
type Partner = { id: string; name: string; kind: "customer" | "supplier" };
type Balance = { warehouse_id: string; product_id: string; qty: number };
type Receipt = { id: string; number: string; receipt_date: string; supplier_id: string | null; warehouse_id: string };

function StockPage() {
  const wsId = useActiveWorkspaceId();

  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("warehouses").select("id,name,is_default").eq("workspace_id", wsId).order("is_default", { ascending: false }).order("name")).data as Warehouse[],
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("products").select("id,name,unit,cost,price,kind").eq("workspace_id", wsId).order("name")).data as Product[],
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("partners").select("id,name,kind").eq("workspace_id", wsId).order("name")).data as Partner[],
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Склад</h1>
        <p className="text-sm text-muted-foreground">Остатки товаров и поступления</p>
      </div>

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Остатки</TabsTrigger>
          <TabsTrigger value="receipts">Поступления</TabsTrigger>
          <TabsTrigger value="batches">Партии и себестоимость</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-5">
          <BalancesTab warehouses={warehouses} products={products} />
        </TabsContent>

        <TabsContent value="batches" className="mt-5">
          <BatchesTab products={products} />
        </TabsContent>

        <TabsContent value="receipts" className="mt-5">
          <ReceiptsTab
            warehouses={warehouses}
            products={products.filter(p => p.kind !== "service")}
            partners={partners.filter(p => p.kind === "supplier")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Остатки
// ============================================================
function BalancesTab({ warehouses, products }: { warehouses: Warehouse[]; products: Product[] }) {
  const wsId = useActiveWorkspaceId();
  const [whId, setWhId] = useState<string>("");

  const { data: balances = [] } = useQuery({
    queryKey: ["stock_balances", wsId],
    enabled: !!wsId,
    queryFn: async () => fetchBalances(wsId!),
  });

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);

  const filtered = balances.filter(b => (!whId || b.warehouse_id === whId) && Number(b.qty) !== 0);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b flex items-center gap-3">
        <Label className="text-xs">Склад:</Label>
        <Select value={whId || "all"} onValueChange={v => setWhId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все склады</SelectItem>
            {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Товар</TableHead>
            <TableHead>Склад</TableHead>
            <TableHead className="text-right w-32">Остаток</TableHead>
            <TableHead className="w-24">Ед.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Остатков пока нет — оформите поступление товара</TableCell></TableRow>
          )}
          {filtered.map(b => {
            const p = productMap.get(b.product_id);
            const w = whMap.get(b.warehouse_id);
            return (
              <TableRow key={`${b.warehouse_id}-${b.product_id}`}>
                <TableCell className="font-medium">{p?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{w?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmtQty.format(Number(b.qty))}</TableCell>
                <TableCell className="text-muted-foreground">{p?.unit ?? ""}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

// ============================================================
// Поступления
// ============================================================
type NewRow = { product_id: string | null; name: string; qty: number; price: number };

function ReceiptsTab({ warehouses, products, partners }: { warehouses: Warehouse[]; products: Product[]; partners: Partner[] }) {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);

  const { data: receipts = [] } = useQuery({
    queryKey: ["stock_receipts", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("stock_receipts")
      .select("id,number,receipt_date,supplier_id,warehouse_id")
      .eq("workspace_id", wsId).order("receipt_date", { ascending: false })).data as Receipt[],
  });

  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p])), [partners]);
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      await (db as any).from("stock_movements").delete().eq("doc_type", "receipt").eq("doc_id", id);
      await (db as any).from("stock_receipt_items").delete().eq("receipt_id", id);
      const { error } = await (db as any).from("stock_receipts").delete().eq("id", id);
      if (error) throw error;
      if (wsId) await costsRecalc({ data: { workspaceId: wsId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_receipts"] });
      qc.invalidateQueries({ queryKey: ["stock_balances"] });
      qc.invalidateQueries({ queryKey: ["cost_batches"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Удалено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} disabled={warehouses.length === 0}>
          <Plus className="h-4 w-4 mr-1" /> Новое поступление
        </Button>
      </div>
      {warehouses.length === 0 && (
        <div className="text-sm text-muted-foreground">Сначала добавьте склад в Настройках → Справочники.</div>
      )}
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Поставщик</TableHead>
              <TableHead>Склад</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Поступлений пока нет</TableCell></TableRow>
            )}
            {receipts.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.number}</TableCell>
                <TableCell>{new Date(r.receipt_date).toLocaleDateString("ru-RU")}</TableCell>
                <TableCell>{r.supplier_id ? (partnerMap.get(r.supplier_id)?.name ?? "—") : "—"}</TableCell>
                <TableCell>{whMap.get(r.warehouse_id)?.name ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить поступление № ${r.number}? Остатки уменьшатся на его количество.`)) del.mutate(r.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <NewReceiptDialog
        open={open}
        onOpenChange={setOpen}
        warehouses={warehouses}
        products={products}
        partners={partners}
      />
    </div>
  );
}

function NewReceiptDialog({
  open, onOpenChange, warehouses, products, partners,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  warehouses: Warehouse[]; products: Product[]; partners: Partner[];
}) {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const defaultWh = warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? "";

  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState<string>("");
  const [whId, setWhId] = useState<string>(defaultWh);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<NewRow[]>([]);
  const [pickRow, setPickRow] = useState<number | null>(null);

  const total = rows.reduce((s, r) => s + r.qty * r.price, 0);

  const reset = () => {
    setNumber(""); setDate(new Date().toISOString().slice(0, 10));
    setSupplierId(""); setWhId(defaultWh); setNote(""); setRows([]);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!wsId) throw new Error("Не выбрана база данных");
      if (!whId) throw new Error("Выберите склад");
      if (!number.trim()) throw new Error("Укажите номер документа");
      const clean = rows.filter(r => r.product_id && r.qty > 0);
      if (clean.length === 0) throw new Error("Добавьте хотя бы одну позицию");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const { data: hdr, error } = await (db as any).from("stock_receipts").insert({
        user_id: user.id, workspace_id: wsId,
        number: number.trim(), receipt_date: date,
        supplier_id: supplierId || null, warehouse_id: whId,
        note: note.trim() || null,
      }).select("id").single();
      if (error) throw error;
      const items = clean.map(r => ({
        receipt_id: hdr.id,
        product_id: r.product_id,
        qty: r.qty,
        price: r.price,
        sum: r.qty * r.price,
      }));
      const { error: e2 } = await (db as any).from("stock_receipt_items").insert(items);
      if (e2) throw e2;
      // Приход на склад: движения пишем сами (в базе больше нет триггеров).
      const movements = clean.map(r => ({
        user_id: user.id, workspace_id: wsId,
        warehouse_id: whId, product_id: r.product_id,
        qty: r.qty, doc_type: "receipt", doc_id: hdr.id, moved_at: date,
      }));
      const { error: e3 } = await (db as any).from("stock_movements").insert(movements);
      if (e3) throw e3;
      // партии изменились — пересчитываем себестоимость
      await costsRecalc({ data: { workspaceId: wsId } });
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_receipts"] });
      qc.invalidateQueries({ queryKey: ["stock_balances"] });
      qc.invalidateQueries({ queryKey: ["cost_batches"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Поступление проведено");
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRowAndPick = () => {
    const i = rows.length;
    setRows([...rows, { product_id: null, name: "", qty: 1, price: 0 }]);
    setTimeout(() => setPickRow(i), 0);
  };
  const patch = (i: number, p: Partial<NewRow>) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const pickProduct = (i: number, productId: string) => {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    patch(i, { product_id: p.id, name: p.name, price: Number(p.cost) || 0 });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новое поступление товара</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1"><Label className="text-xs">Номер *</Label><Input className="h-8" value={number} onChange={e => setNumber(e.target.value)} placeholder="ПТ-000123" /></div>
            <div className="space-y-1"><Label className="text-xs">Дата</Label><Input className="h-8" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Склад *</Label>
              <Select value={whId} onValueChange={setWhId}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Поставщик</Label>
              <Select value={supplierId || "none"} onValueChange={v => setSupplierId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не указан</SelectItem>
                  {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="font-medium text-sm">Позиции</h3>
              <Button size="sm" variant="outline" onClick={addRowAndPick}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50%]">Товар</TableHead>
                  <TableHead className="w-24 text-right">Кол-во</TableHead>
                  <TableHead className="w-28 text-right">Цена</TableHead>
                  <TableHead className="w-32 text-right">Сумма</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <button type="button" onClick={addRowAndPick} className="w-full py-6 text-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                        + Добавьте позицию
                      </button>
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <button type="button" className="w-full text-left px-2 py-1 rounded hover:bg-accent" onClick={() => setPickRow(i)}>
                        {r.name || <span className="text-muted-foreground">Выберите товар</span>}
                      </button>
                    </TableCell>
                    <TableCell><Input type="number" step="0.001" className="text-right h-8" value={r.qty} onChange={e => patch(i, { qty: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" className="text-right h-8" value={r.price} onChange={e => patch(i, { price: Number(e.target.value) })} /></TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney.format(r.qty * r.price)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeRow(i)}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-3 py-2 border-t flex justify-end items-center gap-3">
              <span className="text-xs text-muted-foreground">Итого:</span>
              <span className="text-base font-semibold">{fmtMoney.format(total)}</span>
            </div>
          </Card>

          <div className="space-y-1">
            <Label className="text-xs">Комментарий</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>

        <ProductPickerSingle
          open={pickRow !== null}
          onOpenChange={(v) => { if (!v) setPickRow(null); }}
          products={products as any}
          onPick={(id) => { if (pickRow !== null) pickProduct(pickRow, id); }}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }}>Отмена</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Провести</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Партии и себестоимость (FIFO)
// ============================================================
type BatchRow = {
  product_id: string;
  cost: number;
  qty: number;
  batches: { qty: number; unit: number; date: string; doc_type: string; doc_id: string | null }[];
};

function BatchesTab({ products }: { products: Product[] }) {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [q, setQ] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cost_batches", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const res = await costsAll({ data: { workspaceId: wsId! } });
      if (res.error) throw new Error(res.error.message);
      return res.rows as BatchRow[];
    },
  });

  const recalc = useMutation({
    mutationFn: async () => {
      const res = await costsRecalc({ data: { workspaceId: wsId! } });
      if (res.error) throw new Error(res.error.message);
      return res;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cost_batches"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Пересчитано: товаров ${r.products}, документов ${r.docs}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const needle = q.trim().toLowerCase();
  const visible = rows
    .filter(r => r.qty > 0 || r.cost > 0)
    .filter(r => !needle || (productMap.get(r.product_id)?.name ?? "").toLowerCase().includes(needle))
    .sort((a, b) => (productMap.get(a.product_id)?.name ?? "").localeCompare(productMap.get(b.product_id)?.name ?? "", "ru"));

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b flex flex-wrap items-center gap-3">
        <Input className="h-8 w-64" placeholder="Поиск товара" value={q} onChange={e => setQ(e.target.value)} />
        <div className="text-xs text-muted-foreground flex-1 min-w-40">
          Себестоимость считается по партиям поступлений: расход списывает сначала самые старые партии.
        </div>
        <Button size="sm" variant="outline" disabled={recalc.isPending} onClick={() => recalc.mutate()}>
          Пересчитать себестоимость
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Товар</TableHead>
            <TableHead className="text-right w-28">Остаток</TableHead>
            <TableHead className="text-right w-32">Себестоимость</TableHead>
            <TableHead className="text-right w-36">Сумма партий</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Считаем…</TableCell></TableRow>
          )}
          {!isLoading && visible.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Партий пока нет — оформите поступление товара</TableCell></TableRow>
          )}
          {visible.map(r => {
            const p = productMap.get(r.product_id);
            const sum = r.batches.reduce((s2, b) => s2 + b.qty * b.unit, 0);
            const isOpen = openRow === r.product_id;
            return (
              <>
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{p?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtQty.format(r.qty)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney.format(r.cost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney.format(sum)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={r.batches.length === 0}
                      onClick={() => setOpenRow(isOpen ? null : r.product_id)}>
                      {isOpen ? "Скрыть" : `Партии (${r.batches.length})`}
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen && r.batches.map((b, i) => (
                  <TableRow key={`${r.product_id}-b${i}`} className="bg-muted/40">
                    <TableCell className="pl-8 text-sm text-muted-foreground">
                      Партия от {new Date(b.date).toLocaleDateString("ru-RU")}
                      {b.doc_type === "receipt" ? " (поступление)" : b.doc_type === "shipment" ? " (закупка)" : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtQty.format(b.qty)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtMoney.format(b.unit)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtMoney.format(b.qty * b.unit)}</TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
