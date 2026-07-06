import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { ProductPicker, type PickedItem } from "@/components/ProductPicker";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  head: () => ({ meta: [{ title: "Новая заявка — КабинетCRM" }] }),
  component: NewInvoice,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

type Item = { product_id: string | null; name: string; quantity: number; price: number; kind: "product" | "service" };

const DRAFT_KEY = "invoice-new-draft-v1";
type Draft = {
  kind: "outgoing" | "incoming";
  number: string;
  date: string;
  partnerId: string;
  note: string;
  items: Item[];
  numberTouched: boolean;
};

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

function NewInvoice() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<"outgoing" | "incoming">("outgoing");
  const { data: org } = useQuery({
    queryKey: ["my-organization-mask"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("invoice_number_mask,invoice_number_start").order("is_primary", { ascending: false }).limit(1).maybeSingle();
      return data as { invoice_number_mask: string; invoice_number_start: number } | null;
    },
  });
  const { data: invoiceCount } = useQuery({
    queryKey: ["invoices-count"],
    queryFn: async () => {
      const { count } = await supabase.from("invoices").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });
  const seqRef = useRef<number | null>(null);
  const mask = org?.invoice_number_mask || "{YYYY}-{MM}-{DD}-{NNN}";
  const [number, setNumber] = useState("");
  const numberTouched = useRef(false);
  useEffect(() => {
    if (numberTouched.current) return;
    if (org === undefined || invoiceCount === undefined) return;
    const start = Math.max(1, Math.floor(Number(org?.invoice_number_start ?? 1)));
    if (seqRef.current === null) seqRef.current = start + (invoiceCount ?? 0);
    setNumber(applyNumberMask(mask, new Date(), seqRef.current));
  }, [org, invoiceCount, mask]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [partnerId, setPartnerId] = useState<string>("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pickRow, setPickRow] = useState<number | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const draftReadyRef = useRef(false);
  const draftDeletedRef = useRef(false);
  const latestDraftRef = useRef<Draft>({
    kind,
    number,
    date,
    partnerId,
    note,
    items,
    numberTouched: numberTouched.current,
  });
  const persistDraftNowRef = useRef<() => void>(() => {});

  latestDraftRef.current = {
    kind,
    number,
    date,
    partnerId,
    note,
    items,
    numberTouched: numberTouched.current,
  };
  persistDraftNowRef.current = () => {
    if (!draftReadyRef.current || draftDeletedRef.current || typeof window === "undefined") return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(latestDraftRef.current)); } catch {}
  };

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(DRAFT_KEY) : null;
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (d.kind) setKind(d.kind);
        if (d.number) { setNumber(d.number); numberTouched.current = !!d.numberTouched; }
        if (d.date) setDate(d.date);
        if (d.partnerId) setPartnerId(d.partnerId);
        if (d.note) setNote(d.note);
        if (Array.isArray(d.items)) setItems(d.items);
      }
    } catch {}
    setDraftReady(true);
  }, []);

  // Persist draft on every change (after initial load)
  useEffect(() => {
    draftReadyRef.current = draftReady;
    persistDraftNowRef.current();
  }, [draftReady, kind, number, date, partnerId, note, items]);

  useEffect(() => {
    const flushDraft = () => persistDraftNowRef.current();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };

    window.addEventListener("crm:flush-invoice-draft", flushDraft);
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      flushDraft();
      window.removeEventListener("crm:flush-invoice-draft", flushDraft);
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  const clearDraft = () => {
    draftDeletedRef.current = true;
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  };

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id,name,price,cost,unit,kind").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase.from("partners").select("id,name,kind").order("name");
      if (error) throw error;
      return data;
    },
  });

  const filteredPartners = partners.filter((p: any) =>
    kind === "outgoing" ? p.kind === "customer" : p.kind === "supplier"
  );

  const total = useMemo(() => items.reduce((s, i) => s + i.quantity * i.price, 0), [items]);

  const addItem = () => setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product" }]);
  const addItemAndPick = () => {
    const newIdx = items.length;
    setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product" }]);
    setTimeout(() => setPickRow(newIdx), 0);
  };
  const updateItem = (idx: number, patch: Partial<Item>) =>
    setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const pickProduct = (idx: number, productId: string) => {
    const p: any = products.find((x: any) => x.id === productId);
    if (!p) return;
    updateItem(idx, {
      product_id: p.id,
      name: p.name,
      price: kind === "outgoing" ? Number(p.price) : Number(p.cost),
      kind: (p.kind ?? "product") as "product" | "service",
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");

      const { data: inv, error } = await (supabase as any).from("invoices").insert({
        user_id: user.id,
        number, kind,
        partner_id: partnerId || null,
        issue_date: date,
        status: "draft",
        doc_type: "order",
        note: note || null,
      }).select().single();
      if (error) throw error;

      const rows = items.map(it => ({
        invoice_id: inv.id,
        product_id: it.product_id,
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        sum: it.quantity * it.price,
        kind: it.kind ?? "product",
      }));
      const { error: itemsErr } = await supabase.from("invoice_items").insert(rows);
      if (itemsErr) throw itemsErr;

      return inv.id as string;
    },
    onSuccess: (id) => { clearDraft(); toast.success("Заявка сохранена"); navigate({ to: "/invoices/$id", params: { id } }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Новая заявка</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => {
            if (confirm("Отменить создание заявки? Черновик будет удалён.")) {
              clearDraft();
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
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outgoing">Расход (продажа)</SelectItem>
                <SelectItem value="incoming">Приход (поступление)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Номер</Label>
            <Input className="h-8" value={number} onChange={e => { numberTouched.current = true; setNumber(e.target.value); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата</Label>
            <Input className="h-8" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{kind === "outgoing" ? "Покупатель" : "Поставщик"}</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Не выбран" /></SelectTrigger>
              <SelectContent>
                {filteredPartners.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет контрагентов</div>}
                {filteredPartners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <h3 className="font-medium text-sm">Позиции</h3>
          <div className="flex gap-2">
            <ProductPicker
              products={products as any}
              kind={kind}
              onAdd={(picked: PickedItem[]) => setItems((prev) => [...prev, ...picked])}
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
                  <button
                    type="button"
                    className="xls-cell text-left hover:bg-accent"
                    onClick={() => setPickRow(idx)}
                  >
                    {it.name || <span className="text-muted-foreground">Выберите товар</span>}
                  </button>
                </TableCell>
                <TableCell><Input type="number" step="0.001" className="xls-cell text-right" value={it.quantity} onChange={e => updateItem(idx, { quantity: Number(e.target.value) })} /></TableCell>
                <TableCell><Input type="number" step="0.01" className="xls-cell text-right" value={it.price} onChange={e => updateItem(idx, { price: Number(e.target.value) })} /></TableCell>
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
        <Textarea className="mt-1 text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </Card>
    </div>
  );
}
