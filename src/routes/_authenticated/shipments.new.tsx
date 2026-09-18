import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";

export const Route = createFileRoute("/_authenticated/shipments/new")({
  head: () => ({ meta: [{ title: "Новая накладная — КабинетCRM" }] }),
  component: NewShipment,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

type Row = { product_id: string | null; name: string; quantity: number; price: number; kind: "product" | "service" };

function NewShipment() {
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();

  const [kind, setKind] = useState<"outgoing" | "incoming">("outgoing");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [partnerId, setPartnerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [pickRow, setPickRow] = useState<number | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("products").select("id,name,price,cost,unit,kind,prices").eq("workspace_id", wsId).order("name")).data ?? [],
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["partners", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("partners").select("id,name,kind").eq("workspace_id", wsId).order("name")).data ?? [],
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("warehouses").select("id,name,is_default").eq("workspace_id", wsId).order("is_default", { ascending: false }).order("name")).data ?? [],
  });
  const { data: shipCount = 0 } = useQuery({
    queryKey: ["shipments-count", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { count } = await (db as any).from("invoices").select("id", { count: "exact", head: true }).eq("workspace_id", wsId).eq("doc_type", "shipment");
      return count ?? 0;
    },
  });

  const autoNumber = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `Н-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(shipCount + 1).padStart(3, "0")}`;
  }, [shipCount]);

  const effectiveNumber = number || autoNumber;
  const defaultWh = (warehouses as any[]).find(w => w.is_default)?.id ?? (warehouses as any[])[0]?.id ?? "";
  const effectiveWh = warehouseId || defaultWh;
  const filteredPartners = (partners as any[]).filter(p => kind === "outgoing" ? p.kind === "customer" : p.kind === "supplier");
  const total = useMemo(() => items.reduce((s, i) => s + i.quantity * i.price, 0), [items]);

  const update = (idx: number, patch: Partial<Row>) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addRow = () => {
    const idx = items.length;
    setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product" }]);
    setTimeout(() => setPickRow(idx), 0);
  };
  const pickProduct = (idx: number, productId: string) => {
    const p: any = (products as any[]).find(x => x.id === productId);
    if (!p) return;
    update(idx, {
      product_id: p.id,
      name: p.name,
      price: kind === "outgoing" ? Number(p.price ?? 0) : Number(p.cost ?? 0),
      kind: (p.kind ?? "product") as "product" | "service",
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!wsId) throw new Error("Не выбрана база данных");
      if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
      if (!effectiveWh) throw new Error("Создайте склад в настройках — накладная без склада не проводится");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");

      const { data: inv, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: wsId,
        number: effectiveNumber,
        kind,
        partner_id: partnerId || null,
        warehouse_id: effectiveWh,
        issue_date: date,
        status: "draft",
        doc_type: "shipment",
        note: note || null,
      }).select("id").single();
      if (error) throw error;

      const rows = items.map(it => ({
        invoice_id: inv.id,
        product_id: it.product_id,
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        sum: it.quantity * it.price,
        kind: it.kind,
      }));
      const { error: e2 } = await db.from("invoice_items").insert(rows);
      if (e2) throw e2;
      return inv.id as string;
    },
    onSuccess: (id) => {
      toast.success("Накладная создана");
      navigate({ to: "/invoices/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Новая накладная</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/shipments" })}>Отменить</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить накладную</Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Тип</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">Продажа (списание)</SelectItem>
                <SelectItem value="incoming">Закупка (поступление)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Номер</Label>
            <Input className="h-8" value={effectiveNumber} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата</Label>
            <Input className="h-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Контрагент</Label>
            <Select value={partnerId || undefined} onValueChange={setPartnerId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                {filteredPartners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Склад</Label>
            <Select value={effectiveWh || undefined} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                {(warehouses as any[]).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Позиции</h2>
          <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-4 w-4 mr-1" /> Добавить позицию</Button>
        </div>
        <Table className="xls-table">
          <TableHeader>
            <TableRow>
              <TableHead>Наименование</TableHead>
              <TableHead className="w-24 text-right">Кол-во</TableHead>
              <TableHead className="w-32 text-right">Цена</TableHead>
              <TableHead className="w-32 text-right">Сумма</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Позиций пока нет</TableCell></TableRow>
            )}
            {items.map((it, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <button className="text-left w-full hover:underline" onClick={() => setPickRow(idx)}>
                    {it.name || <span className="text-muted-foreground">выбрать товар…</span>}
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <Input className="h-7 text-right" type="number" step="0.001" value={it.quantity}
                    onChange={(e) => update(idx, { quantity: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="text-right">
                  <Input className="h-7 text-right" type="number" step="0.01" value={it.price}
                    onChange={(e) => update(idx, { price: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="text-right font-medium">{fmt.format(it.quantity * it.price)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-right font-semibold">Итого: {fmt.format(total)}</div>
      </Card>

      <Card className="p-3">
        <Label className="text-xs">Комментарий</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Card>

      <ProductPickerSingle
        open={pickRow !== null}
        onOpenChange={(v) => { if (!v) setPickRow(null); }}
        products={products as any}
        onPick={(productId) => { if (pickRow !== null) pickProduct(pickRow, productId); }}
      />
    </div>
  );
}
