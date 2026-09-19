import { NumCell } from "@/components/NumCell";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { PartnerPicker } from "@/components/PartnerPicker";
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
import { usePriceTypes, useMyPriceTypeId, priceOf } from "@/lib/price-types";
import { grossSum } from "@/lib/discounts";
import { useOrganizations, useMyOrgId, pickOrg } from "@/lib/organizations";

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
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const draft = useDraft();
  const { kind, number, date, partnerId, statusId, note, items, numberTouched } = draft;

  // Юрлица базы; заявка выписывается от выбранной организации
  // (по умолчанию — организация текущего входа, иначе основная)
  const { data: orgs = [] } = useOrganizations(wsId);
  const { data: myOrgId } = useMyOrgId(wsId);
  const [orgId, setOrgId] = useState<string>("");
  const org = pickOrg(orgs, orgId || myOrgId || null);
  const effOrgId = org?.id ?? null;
  const { data: invoiceCount } = useQuery({
    queryKey: ["invoices-count", wsId, effOrgId],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (db as any).from("invoices").select("id", { count: "exact", head: true }).eq("workspace_id", wsId);
      if (effOrgId) q = q.eq("organization_id", effOrgId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const seqRef = useRef<number | null>(null);
  // при смене юрлица нумерация пересчитывается заново
  useEffect(() => { seqRef.current = null; }, [effOrgId]);
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
  const [showMore, setShowMore] = useState(false);
  const { data: priceTypes = [] } = usePriceTypes(wsId);
  const myPriceTypeId = useMyPriceTypeId(wsId);
  const [priceTypeOverride, setPriceTypeOverride] = useState<string | null>(null);
  const priceTypeId = priceTypeOverride ?? myPriceTypeId;

  const { data: products = [] } = useQuery({
    queryKey: ["products", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("products").select("id,name,price,cost,unit,kind,prices,folder_id").eq("workspace_id", wsId).order("name")).data ?? [],
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

  const total = useMemo(() => items.reduce((s, i) => s + grossSum(i.quantity, i.price), 0), [items]);

  const setItems = (next: DraftItem[]) => invoiceDraft.set({ items: next });
  const addItemAndPick = () => {
    const newIdx = items.length;
    setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product" }]);
    setTimeout(() => setPickRow(newIdx), 0);
  };
  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const applyPriceType = (v: string) => {
    setPriceTypeOverride(v);
    if (kind !== "outgoing") return;
    setItems(items.map((it) => {
      const p: any = products.find((x: any) => x.id === it.product_id);
      return p ? { ...it, price: priceOf(p, v) } : it;
    }));
  };

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
        organization_id: effOrgId,
      }).select().single();
      if (error) throw error;

      const rows = items.map((it) => ({
        invoice_id: inv.id,
        product_id: it.product_id,
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        sum: grossSum(it.quantity, it.price),
        kind: it.kind ?? "product",
      }));
      const { error: itemsErr } = await db.from("invoice_items").insert(rows);
      if (itemsErr) throw itemsErr;

      return inv.id as string;
    },
    onSuccess: (id) => {
      invoiceDraft.reset();
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-count"] });
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
        {orgs.length > 1 && (
          <div className="mb-2 flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">От юрлица:</Label>
            <Select value={effOrgId ?? ""} onValueChange={setOrgId}>
              <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Выберите организацию" /></SelectTrigger>
              <SelectContent>
                {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
            <Label className="text-xs">{kind === "outgoing" ? "Покупатель" : "Поставщик"}</Label>
            <PartnerPicker value={partnerId || null} onChange={(v) => invoiceDraft.set({ partnerId: v })} kind={kind === "outgoing" ? "customer" : "supplier"} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата</Label>
            <Input className="h-8" type="date" value={date} onChange={(e) => invoiceDraft.set({ date: e.target.value })} />
          </div>
        </div>

        <button type="button" onClick={() => setShowMore(v => !v)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground underline">
          {showMore ? "Скрыть" : `Ещё: № ${number}${statusId ? `, статус` : ""}${priceTypes.length > 1 ? ", тип цены" : ""}`}
        </button>

        {showMore && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Номер</Label>
              <Input className="h-8" value={number} onChange={(e) => invoiceDraft.set({ number: e.target.value, numberTouched: true })} />
            </div>
            {priceTypes.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Тип цены</Label>
                <Select value={priceTypeId ?? "__none"} onValueChange={applyPriceType} disabled={kind !== "outgoing"}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Не задан" /></SelectTrigger>
                  <SelectContent>
                    {priceTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {statuses.length > 0 && (
              <div className="space-y-1">
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
              priceTypeId={priceTypeId}
              workspaceId={wsId}
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
                <TableCell><NumCell grid="invnew" row={idx} col={0} step="0.001" className="xls-cell" value={it.quantity} onCommit={(v) => updateItem(idx, { quantity: v })} /></TableCell>
                <TableCell><NumCell grid="invnew" row={idx} col={1} step="0.01" className="xls-cell" value={it.price} onCommit={(v) => updateItem(idx, { price: v })} /></TableCell>
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
