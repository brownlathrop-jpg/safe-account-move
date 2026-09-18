import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import { ProductPicker, type PickedItem } from "@/components/ProductPicker";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";
import { invoiceDraft, type DraftItem } from "@/lib/invoice-draft";
import { useActiveWorkspaceId } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  head: () => ({ meta: [{ title: "Новая заявка — КабинетCRM" }] }),
  component: NewInvoice,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

function applyNumberMask(mask: string, d: Date, seq: number): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return mask
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{YY\}/g, pad(d.getFullYear() % 100, 2))
    .replace(/\{MM\}/g, pad(d.getMonth() + 1, 2))
    .replace(/\{DD\}/g, pad(d.getDate(), 2))
    .replace(/\{NNNN\}/g, pad(seq, 4))
    .replace(/\{NNN\}/g, pad(seq, 3))
    .replace(/\{NN\}/g, pad(seq, 2))
    .replace(/\{N\}/g, String(seq));
}

function useDraft() {
  return useSyncExternalStore(
    (l) => invoiceDraft.subscribe(l),
    () => invoiceDraft.get(),
    () => invoiceDraft.get(),
  );
}

function NewInvoice() {
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();
  const draft = useDraft();
  const { kind, number, date, partnerId, statusId, note, items, numberTouched } = draft;

  const { data: org } = useQuery({
    queryKey: ["my-organization-mask", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await (db as any).from("organizations").select("invoice_number_mask,invoice_number_start").eq("workspace_id", wsId).order("is_primary", { ascending: false }).limit(1).maybeSingle();
      return data as { invoice_number_mask: string; invoice_number_start: number } | null;
    },
  });
  const { data: invoiceCount } = useQuery({
    queryKey: ["invoices-count", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { count } = await (db as any).from("invoices").select("id", { count: "exact", head: true }).eq("workspace_id", wsId);
      return count ?? 0;
    },
  });

  const seqRef = useRef<number | null>(null);
  const mask = org?.invoice_number_mask || "{YYYY}-{MM}-{DD}-{NNN}";
  useEffect(() => {
    if (numberTouched) return;
    if (org === undefined || invoiceCount === undefined) return;
    const start = Math.max(1, Math.floor(Number(org?.invoice_number_start ?? 1)));
    if (seqRef.current === null) seqRef.current = start + (invoiceCount ?? 0);
    const auto = applyNumberMask(mask, new Date(), seqRef.current ?? 1);
    if (auto !== number) invoiceDraft.set({ number: auto });
  }, [org, invoiceCount, mask, numberTouched, number]);

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

  const { data: statuses = [] } = useQuery({
    queryKey: ["invoice_statuses", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order")).data ?? [],
  });

  // Автовыбор первого статуса, если ещё не выбран
  useEffect(() => {
    if (!statusId && statuses.length > 0) {
      invoiceDraft.set({ statusId: (statuses[0] as any).id });
    }
  }, [statusId, statuses]);

  const filteredPartners = partners.filter((p: any) =>
    kind === "outgoing" ? p.kind === "customer" : p.kind === "supplier"
  );

  const total = useMemo(() => items.reduce((s, i) => s + i.quantity * i.price, 0), [items]);

  const setItems = (next: DraftItem[]) => invoiceDraft.set({ items: next });
  const addItemAndPick = () => {
    const newIdx = items.length;
    setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product" }]);
    setTimeout(() => setPickRow(newIdx), 0);
  };
  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const pickProduct = (idx: number, productId: string) => {
    const p: any = products.find((x: any) => x.id === productId);
    if (!p) return;
    updateItem(idx, {
      product_id: p.id,
      name: p.name,
      price: kind === "outgoing" ? priceOf(p, priceTypeId) : Number(p.cost),
      kind: (p.kind ?? "product") as "product" | "service",
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
      if (!wsId) throw new Error("Не выбрана база данных");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");

      const { data: inv, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: wsId,
        number, kind,
        partner_id: partnerId || null,
        status_id: statusId || null,
        issue_date: date,
        status: "draft",
        doc_type: "order",
        note: note || null,
      }).select().single();
      if (error) throw error;

      const rows = items.map((it) => ({
        invoice_id: inv.id,
        product_id: it.product_id,
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        sum: it.quantity * it.price,
        kind: it.kind ?? "product",
      }));
      const { error: itemsErr } = await db.from("invoice_items").insert(rows);
      if (itemsErr) throw itemsErr;

      return inv.id as string;
    },
    onSuccess: (id) => {
      invoiceDraft.reset();
      toast.success("Заявка сохранена");
      navigate({ to: "/invoices/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Новая заявка</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => {
            if (confirm("Отменить создание заявки? Черновик будет удалён.")) {
              invoiceDraft.reset();
              navigate({ to: "/invoices" });
            }
          }}>Отменить</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить заявку</Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Тип</Label>
            <Select value={kind} onValueChange={(v) => invoiceDraft.set({ kind: v as any })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">Расход (продажа)</SelectItem>
                <SelectItem value="incoming">Приход (поступление)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Номер</Label>
            <Input className="h-8" value={number} onChange={(e) => invoiceDraft.set({ number: e.target.value, numberTouched: true })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата</Label>
            <Input className="h-8" type="date" value={date} onChange={(e) => invoiceDraft.set({ date: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{kind === "outgoing" ? "Покупатель" : "Поставщик"}</Label>
            <Select value={partnerId} onValueChange={(v) => invoiceDraft.set({ partnerId: v })}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Не выбран" /></SelectTrigger>
              <SelectContent>
                {filteredPartners.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет контрагентов</div>}
                {filteredPartners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {statuses.length > 0 && (
          <div className="mt-3 space-y-1 max-w-xs">
            <Label className="text-xs">Статус</Label>
            <Select value={statusId || undefined} onValueChange={(v) => invoiceDraft.set({ statusId: v })}>
              <SelectTrigger className="h-8">
                <SelectValue>
                  {statusId && (
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: (statuses.find((s: any) => s.id === statusId) as any)?.color ?? "#cbd5e1" }} />
                      {(statuses.find((s: any) => s.id === statusId) as any)?.name}
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <h3 className="font-medium text-sm">Позиции</h3>
          <div className="flex gap-2">
            <ProductPicker
              products={products as any}
              kind={kind}
              onAdd={(picked: PickedItem[]) => setItems([...items, ...picked])}
            />
          </div>
        </div>
        <Table className="xls-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Товар</TableHead>
              <TableHead className="w-24 text-right">Кол-во</TableHead>
              <TableHead className="w-28 text-right">Цена</TableHead>
              <TableHead className="w-32 text-right">Сумма</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="p-0">
                  <button
                    type="button"
                    onClick={addItemAndPick}
                    className="w-full text-center text-muted-foreground py-6 hover:bg-accent hover:text-foreground transition-colors"
                  >
                    + Добавьте позицию
                  </button>
                </TableCell>
              </TableRow>
            )}
            {items.map((it, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <button type="button" className="xls-cell text-left hover:bg-accent" onClick={() => setPickRow(idx)}>
                    {it.name || <span className="text-muted-foreground">Выберите товар</span>}
                  </button>
                </TableCell>
                <TableCell><Input type="number" step="0.001" className="xls-cell text-right" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} /></TableCell>
                <TableCell><Input type="number" step="0.01" className="xls-cell text-right" value={it.price} onChange={(e) => updateItem(idx, { price: Number(e.target.value) })} /></TableCell>
                <TableCell className="text-right font-medium">{fmt.format(it.quantity * it.price)}</TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="px-3 py-2 border-t flex justify-end items-center gap-3">
          <span className="text-xs text-muted-foreground">Итого:</span>
          <span className="text-base font-semibold">{fmt.format(total)}</span>
        </div>
      </Card>

      <ProductPickerSingle
        open={pickRow !== null}
        onOpenChange={(v) => { if (!v) setPickRow(null); }}
        products={products as any}
        onPick={(productId) => { if (pickRow !== null) pickProduct(pickRow, productId); }}
      />

      <Card className="p-3">
        <Label className="text-xs">Комментарий</Label>
        <Textarea className="mt-1 text-sm" rows={2} value={note} onChange={(e) => invoiceDraft.set({ note: e.target.value })} />
      </Card>
    </div>
  );
}
