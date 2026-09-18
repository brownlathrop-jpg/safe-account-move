import { NumCell } from "@/components/NumCell";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { PaymentsCard } from "@/components/PaymentsCard";
import { DocHistoryCard } from "@/components/DocHistoryCard";
import { KktReceiptButton } from "@/components/kkt-receipt-button";
import { applyShipmentStock } from "@/lib/posting";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, CheckCircle2, XCircle, Trash2, Plus, Save, FileEdit, ChevronDown, Copy } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { amountInWords } from "@/lib/amount-in-words";
import { ProductPicker, type PickedItem } from "@/components/ProductPicker";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { usePriceTypes, useMyPriceTypeId, priceOf } from "@/lib/price-types";
import { Torg12 } from "@/components/print/Torg12";
import { Upd } from "@/components/print/Upd";
import type { PrintItem } from "@/components/print/print-types";
import { Checkbox } from "@/components/ui/checkbox";
import { useDiscounts, grossSum, discountSum, netSum, discountLabel, type DiscountKind } from "@/lib/discounts";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Накладная — КабинетCRM" }] }),
  component: InvoiceView,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const nfmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

type Item = {
  id?: string; product_id: string | null; name: string; quantity: number; price: number;
  kind: "product" | "service";
  discount_kind?: DiscountKind | null;
  discount_value?: number | null;
  discount_name?: string | null;
};
type DocType = "order" | "shipment" | "cash_receipt";
type PrintMode = "standard" | "invoice" | "pko" | "torg12" | "upd";

const docLabels: Record<DocType, { title: string; one: string; createLabel: string }> = {
  order: { title: "Заявка", one: "заявку", createLabel: "Заявка" },
  shipment: { title: "Накладная", one: "накладную", createLabel: "Накладная" },
  cash_receipt: { title: "ПКО", one: "ПКО", createLabel: "ПКО" },
};

function InvoiceView() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();

  const { data: inv, isLoading, error } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("invoices")
        .select("*, partner:partners(name,inn,phone,address), items:invoice_items(*)")
        .eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });

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
  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("warehouses").select("id,name,is_default").eq("workspace_id", wsId).order("is_default", { ascending: false }).order("name")).data as { id: string; name: string; is_default: boolean }[] ?? [],
  });
  const { data: myOrg } = useQuery({
    queryKey: ["my-organization", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("organizations").select("*").eq("workspace_id", wsId).order("is_primary", { ascending: false }).limit(1).maybeSingle()).data,
  });
  const { data: statuses = [] } = useQuery({
    queryKey: ["invoice_statuses", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) return [];
      let { data } = await (db as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order");
      if (!data || data.length === 0) {
        const defaults = [
          { name: "Новый", color: "#64748b", sort_order: 0 },
          { name: "Предоплата", color: "#eab308", sort_order: 1 },
          { name: "Оплачен", color: "#3b82f6", sort_order: 2 },
          { name: "Выполнен", color: "#22c55e", sort_order: 3 },
        ].map(s => ({ ...s, user_id: user.id, workspace_id: wsId }));
        await (db as any).from("invoice_statuses").insert(defaults);
        ({ data } = await (db as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order"));
      }
      return (data ?? []) as { id: string; name: string; color: string; sort_order: number }[];
    },
  });

  const [kind, setKind] = useState<"outgoing" | "incoming">("outgoing");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pickRow, setPickRow] = useState<number | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>("standard");
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [cashBasis, setCashBasis] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");

  const doPrint = (mode: PrintMode) => {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
  };


  useEffect(() => {
    if (!inv) return;
    setKind(inv.kind);
    setNumber(inv.number);
    setDate(inv.issue_date);
    setPartnerId(inv.partner_id ?? "");
    setWarehouseId(inv.warehouse_id ?? "");
    setNote(inv.note ?? "");
    setCashReceived(Number(inv.cash_received ?? 0));
    setCashBasis(inv.cash_basis ?? "");
    setPaymentMethod(inv.payment_method === "card" ? "card" : "cash");
    setItems((inv.items ?? []).map((it: any) => ({
      id: it.id, product_id: it.product_id, name: it.name,
      quantity: Number(it.quantity), price: Number(it.price),
      kind: (it.kind ?? "product") as "product" | "service",
      discount_kind: (it.discount_kind === "amount" ? "amount" : "percent") as DiscountKind,
      discount_value: Number(it.discount_value ?? 0),
      discount_name: it.discount_name ?? null,
    })));
  }, [inv]);

  const docType: DocType = (inv?.doc_type ?? "order") as DocType;
  const isOrder = docType === "order";
  const isShipment = docType === "shipment";
  const isPKO = docType === "cash_receipt";

  // Children documents (shipments + PKO) of this order
  const { data: children = [] } = useQuery({
    queryKey: ["invoice-children", id],
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("invoices")
        .select("id,number,doc_type,issue_date,total,status,cash_received")
        .eq("parent_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    // Показываем связанные для любого документа, не только для заявки
  });

  const { data: parent } = useQuery({
    queryKey: ["invoice-parent", inv?.parent_id],
    enabled: !!inv?.parent_id,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("invoices")
        .select("id,number,doc_type,issue_date,kind")
        .eq("id", inv!.parent_id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const lineGross = (it: Item) => grossSum(it.quantity, it.price);
  const lineDiscount = (it: Item) => discountSum(it.quantity, it.price, it.discount_kind, it.discount_value);
  const lineNet = (it: Item) => netSum(it.quantity, it.price, it.discount_kind, it.discount_value);
  const totalGross = useMemo(() => items.reduce((s, i) => s + lineGross(i), 0), [items]);
  const totalDiscount = useMemo(() => items.reduce((s, i) => s + lineDiscount(i), 0), [items]);
  const total = useMemo(() => items.reduce((s, i) => s + lineNet(i), 0), [items]);
  const filteredPartners = partners.filter((p: any) => kind === "outgoing" ? p.kind === "customer" : p.kind === "supplier");
  const editable = inv?.status !== "cancelled";
  const { data: priceTypes = [] } = usePriceTypes(wsId);
  const myPriceTypeId = useMyPriceTypeId(wsId);
  const [priceTypeOverride, setPriceTypeOverride] = useState<string | null>(null);
  const priceTypeId = priceTypeOverride ?? myPriceTypeId;

  /* ---- Скидки по позициям ---- */
  const { data: discountRefs = [] } = useDiscounts(wsId);
  const [selected, setSelected] = useState<number[]>([]);
  const [manualKind, setManualKind] = useState<DiscountKind>("percent");
  const [manualValue, setManualValue] = useState("");
  const toggleSel = (idx: number) =>
    setSelected(sel => sel.includes(idx) ? sel.filter(i => i !== idx) : [...sel, idx]);
  const applyDiscount = (kind: DiscountKind, value: number, name: string | null) => {
    const target = selected.length ? selected : items.map((_, i) => i);
    setItems(items.map((it, i) => target.includes(i)
      ? { ...it, discount_kind: kind, discount_value: value, discount_name: name }
      : it));
    if (value > 0) toast.success(`Скидка ${discountLabel(kind, value)} применена к ${target.length} позициям`);
    else toast.success("Скидка снята");
  };

  const addItem = () => setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product", discount_kind: "percent", discount_value: 0 }]);
  const addItemAndPick = () => {
    const newIdx = items.length;
    setItems([...items, { product_id: null, name: "", quantity: 1, price: 0, kind: "product", discount_kind: "percent", discount_value: 0 }]);
    setTimeout(() => setPickRow(newIdx), 0);
  };
  const updateItem = (idx: number, patch: Partial<Item>) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const applyPriceType = (v: string) => {
    setPriceTypeOverride(v);
    if (kind !== "outgoing") return;
    setItems(items.map(it => {
      const p: any = products.find((x: any) => x.id === it.product_id);
      return p ? { ...it, price: priceOf(p, v) } : it;
    }));
  };

  const pickProduct = (idx: number, productId: string) => {
    const p: any = products.find((x: any) => x.id === productId);
    if (!p) return;
    updateItem(idx, { product_id: p.id, name: p.name, price: kind === "outgoing" ? priceOf(p, priceTypeId) : Number(p.cost), kind: (p.kind ?? "product") as "product" | "service" });
  };

  const save = useMutation({
    mutationFn: async () => {
      const wasPosted = inv?.status === "posted";
      if (wasPosted) {
        const { error } = await db.from("invoices").update({ status: "draft" }).eq("id", id);
        if (error) throw error;
      }

      const { error: upErr } = await (db as any).from("invoices").update({
        kind, number, issue_date: date, partner_id: partnerId || null, note: note || null,
        warehouse_id: isShipment ? (warehouseId || null) : null,
        cash_received: isPKO ? cashReceived : null,
        cash_basis: isPKO ? (cashBasis || null) : null,
        payment_method: paymentMethod,
      }).eq("id", id);
      if (upErr) throw upErr;

      const rows = items.map(it => ({
        id: it.id,
        invoice_id: id, product_id: it.product_id, name: it.name,
        quantity: it.quantity, price: it.price, sum: lineNet(it),
        kind: it.kind ?? "product",
        discount_kind: it.discount_kind ?? "percent",
        discount_value: Number(it.discount_value) || 0,
        discount_name: it.discount_name ?? null,
      }));

      const existingRows = rows.filter((row) => Boolean(row.id));
      const newRows = rows.filter((row) => !row.id).map(({ id: _id, ...row }) => row);

      for (const row of existingRows) {
        const { id: itemId, ...patch } = row;
        const { error: itemErr } = await db.from("invoice_items").update(patch).eq("id", itemId as string);
        if (itemErr) throw itemErr;
      }

      if (newRows.length) {
        const { error: insErr } = await db.from("invoice_items").insert(newRows);
        if (insErr) throw insErr;
      }

      const keptIds = existingRows.map((row) => row.id).filter(Boolean) as string[];
      const originalIds = (inv?.items ?? []).map((it: any) => it.id).filter(Boolean) as string[];
      const removedIds = originalIds.filter((itemId) => !keptIds.includes(itemId));
      if (removedIds.length) {
        const { error: delErr } = await db.from("invoice_items").delete().in("id", removedIds).eq("invoice_id", id);
        if (delErr) throw delErr;
      }

      if (wasPosted) {
        const { error } = await db.from("invoices").update({ status: "posted" }).eq("id", id);
        if (error) throw error;
      }
      if (isShipment) await applyShipmentStock(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["shipments"] });
      toast.success("Сохранено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async (status: "posted" | "cancelled" | "draft") => {
      const { error } = await db.from("invoices").update({ status }).eq("id", id);
      if (error) throw error;
      if (isShipment) await applyShipmentStock(id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice", id] }); toast.success("Статус обновлён"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatusId = useMutation({
    mutationFn: async (status_id: string) => {
      const { error } = await db.from("invoices").update({ status_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice", id] }); toast.success("Статус обновлён"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // auto-assign default status (first by sort) if invoice has none
  useEffect(() => {
    if (inv && !inv.status_id && statuses.length > 0) {
      setStatusId.mutate(statuses[0].id);
    }
     
  }, [inv?.id, statuses.length]);

  const createShipment = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const cleanNum = String(inv!.number).replace(/^№\s*/, "");
      const defaultWh = warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? null;
      const { data: ship, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: inv!.workspace_id ?? wsId,
        number: `Н-${cleanNum}`,
        kind: inv!.kind,
        partner_id: inv!.partner_id,
        warehouse_id: defaultWh,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        doc_type: "shipment",
        parent_id: id,
        note: `На основании заявки № ${cleanNum}`,
      }).select().single();
      if (error) throw error;
      // Copy items
      const rows = items.map(it => ({
        invoice_id: ship.id, product_id: it.product_id, name: it.name,
        quantity: it.quantity, price: it.price, sum: it.quantity * it.price,
        kind: it.kind ?? "product",
      }));
      if (rows.length) {
        const { error: insErr } = await db.from("invoice_items").insert(rows);
        if (insErr) throw insErr;
      }
      return ship.id as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["invoice-children", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["shipments"] });
      toast.success("Накладная создана");
      navigate({ to: "/invoices/$id", params: { id: newId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createReceipt = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const cleanNum = String(inv!.number).replace(/^№\s*/, "");
      const { data: pko, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: inv!.workspace_id ?? wsId,
        // продажа → деньги приходят в кассу (ПКО), закупка → деньги уходят (РКО)
        number: `${inv!.kind === "outgoing" ? "ПКО" : "РКО"}-${cleanNum}`,
        kind: inv!.kind === "outgoing" ? "incoming" : "outgoing",
        partner_id: inv!.partner_id,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        doc_type: "cash_receipt",
        parent_id: id,
        cash_received: Number(inv!.total) || total || 0,
        cash_basis: `Оплата по заявке № ${cleanNum} от ${dfmt.format(new Date(inv!.issue_date))}`,
      }).select().single();
      if (error) throw error;
      return pko.id as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["invoice-children", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success("ПКО создан");
      navigate({ to: "/invoices/$id", params: { id: newId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Копия документа или возврат (документ обратного вида). */
  const duplicate = useMutation({
    mutationFn: async (mode: "copy" | "return") => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const cleanNum = String(inv!.number).replace(/^№\s*/, "");
      const isReturn = mode === "return";
      const newKind = isReturn ? (kind === "outgoing" ? "incoming" : "outgoing") : kind;
      const prefix = isReturn ? "В" : "К";
      const { data: doc, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: inv!.workspace_id ?? wsId,
        number: `${prefix}-${cleanNum}`,
        kind: newKind,
        partner_id: inv!.partner_id,
        warehouse_id: isShipment ? (warehouseId || null) : null,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        doc_type: docType,
        is_return: isReturn,
        parent_id: isReturn ? id : null,
        cash_received: isPKO ? cashReceived : null,
        cash_basis: isPKO ? (cashBasis || null) : null,
        note: isReturn
          ? `Возврат по ${isShipment ? "накладной" : "документу"} № ${cleanNum}`
          : (note || null),
      }).select("id").single();
      if (error) throw error;
      const rows = items.map(it => ({
        invoice_id: doc.id, product_id: it.product_id, name: it.name,
        quantity: it.quantity, price: it.price, sum: it.quantity * it.price,
        kind: it.kind ?? "product",
      }));
      if (rows.length) {
        const { error: insErr } = await db.from("invoice_items").insert(rows);
        if (insErr) throw insErr;
      }
      return doc.id as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["invoice-children", id] });
      toast.success("Документ создан");
      navigate({ to: "/invoices/$id", params: { id: newId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  if (error) return <div className="text-destructive">Ошибка загрузки: {(error as Error).message}</div>;
  if (isLoading || !inv) return <div className="text-muted-foreground">Загрузка…</div>;

  const partnerObj = inv.partner;
  const orgAsParty = myOrg ? {
    name: myOrg.name,
    inn: myOrg.inn,
    kpp: myOrg.kpp,
    phone: myOrg.phone,
    address: myOrg.legal_address,
    bank_name: myOrg.bank_name,
    bank_bik: myOrg.bank_bik,
    bank_account: myOrg.bank_account,
    bank_corr_account: myOrg.bank_corr_account,
  } : null;
  const supplierLine: any = kind === "outgoing" ? orgAsParty : partnerObj;
  const buyerLine: any = kind === "outgoing" ? partnerObj : orgAsParty;
  const cleanNumber = String(inv.number).replace(/^№\s*/, "");
  const docTitle = isPKO ? (kind === "outgoing" ? "РКО" : "ПКО") : docLabels[docType].title;
  const title = printMode === "pko"
    ? `${kind === "outgoing" ? "Расходный" : "Приходный"} кассовый ордер № ${cleanNumber}`
    : printMode === "invoice"
    ? `Счёт на оплату № ${cleanNumber} от ${dfmt.format(new Date(inv.issue_date))}`
    : isShipment
      ? (kind === "outgoing"
          ? `Расходная накладная № ${cleanNumber} от ${dfmt.format(new Date(inv.issue_date))}`
          : `Приходная накладная № ${cleanNumber} от ${dfmt.format(new Date(inv.issue_date))}`)
      : (kind === "outgoing"
          ? `Заказ покупателя № ${cleanNumber} от ${dfmt.format(new Date(inv.issue_date))}`
          : `Приходная заявка № ${cleanNumber} от ${dfmt.format(new Date(inv.issue_date))}`);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between print:hidden gap-2 flex-wrap">
        <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> К списку заявок
        </Link>
        <div className="flex gap-2 items-center flex-wrap">
          {statuses.length > 0 && (
            <Select value={inv.status_id ?? undefined} onValueChange={(v) => setStatusId.mutate(v)}>
              <SelectTrigger className="w-[180px] h-9">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: statuses.find(s => s.id === inv.status_id)?.color ?? "#cbd5e1" }}
                  />
                  <SelectValue placeholder="Статус" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {statuses.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isShipment && (
            <Badge variant={inv.status === "posted" ? "default" : inv.status === "draft" ? "secondary" : "destructive"}>
              Учёт: {inv.status === "posted" ? "Проведена" : inv.status === "draft" ? "Черновик" : "Отменена"}
            </Badge>
          )}
          {editable && <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" /> Сохранить</Button>}
          {isShipment && kind === "outgoing" && inv.status !== "cancelled" && (
            <>
              <Select value={paymentMethod} onValueChange={(v) => {
                const m = v as "cash" | "card";
                setPaymentMethod(m);
                (db as any).from("invoices").update({ payment_method: m }).eq("id", id)
                  .then(() => qc.invalidateQueries({ queryKey: ["invoice", id] }));
              }}>
                <SelectTrigger className="w-[170px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Наличные</SelectItem>
                  <SelectItem value="card">По терминалу</SelectItem>
                </SelectContent>
              </Select>
              <KktReceiptButton
                wsId={wsId}
                invoiceId={id}
                items={items.map((it) => ({
                  name: it.name,
                  quantity: it.quantity,
                  price: it.quantity ? Math.round((lineNet(it) / it.quantity) * 100) / 100 : it.price,
                  kind: it.kind,
                }))}
                fiscal={inv.fiscal}
                isReturn={!!inv.is_return}
                defaultPaymentType={paymentMethod === "card" ? "electronically" : "cash"}
              />
            </>
          )}
          {isShipment && inv.status === "draft" && <Button onClick={() => setStatus.mutate("posted")}><CheckCircle2 className="h-4 w-4 mr-1" /> Провести</Button>}
          {isShipment && inv.status === "posted" && <Button variant="outline" onClick={() => setStatus.mutate("draft")}><FileEdit className="h-4 w-4 mr-1" /> Распровести</Button>}
          {inv.status !== "cancelled" && (
            <Button variant="outline" onClick={() => {
              if (!confirm(`Отменить ${docLabels[docType].one}?`)) return;
              setStatus.mutate("cancelled", { onSuccess: () => navigate({ to: "/invoices" }) });
            }}><XCircle className="h-4 w-4 mr-1" /> Отменить</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Copy className="h-4 w-4 mr-1" /> Создать <ChevronDown className="h-4 w-4 ml-1" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => duplicate.mutate("copy")}>Копию этого документа</DropdownMenuItem>
              {!isPKO && (
                <DropdownMenuItem onClick={() => duplicate.mutate("return")}>
                  {kind === "outgoing" ? "Возврат от покупателя" : "Возврат поставщику"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Printer className="h-4 w-4 mr-1" /> Печать <ChevronDown className="h-4 w-4 ml-1" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isPKO ? (
                <DropdownMenuItem onClick={() => doPrint("pko")}>{kind === "outgoing" ? "Расходный кассовый ордер (КО-2)" : "Приходный кассовый ордер (КО-1)"}</DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => doPrint("standard")}>
                    {isShipment
                      ? (kind === "outgoing" ? "Расходная накладная" : "Приходная накладная")
                      : (kind === "outgoing" ? "Заказ покупателя" : "Приходная заявка")}
                  </DropdownMenuItem>
                  {kind === "outgoing" && (
                    <DropdownMenuItem onClick={() => doPrint("invoice")}>Счёт на оплату</DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => doPrint("torg12")}>Товарная накладная ТОРГ-12</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doPrint("upd")}>Универсальный передаточный документ (УПД)</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Header label */}
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">
          {inv.is_return ? "Возврат — " : ""}{docTitle} № {cleanNumber}
        </h1>
        {isShipment && inv.status === "posted" && kind === "outgoing" && (
          <p className="text-sm mt-1">
            Себестоимость: <b>{fmt.format(Number(inv.cost_total ?? 0))}</b>{" · "}
            Прибыль:{" "}
            <b className={Number(inv.total) - Number(inv.cost_total ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}>
              {fmt.format(Number(inv.total) - Number(inv.cost_total ?? 0))}
            </b>
            {Number(inv.total) > 0 && (
              <span className="text-muted-foreground">
                {" "}({Math.round(((Number(inv.total) - Number(inv.cost_total ?? 0)) / Number(inv.total)) * 100)}% от суммы)
              </span>
            )}
          </p>
        )}
        {inv.parent_id && (
          <p className="text-sm text-muted-foreground mt-1">
            На основании{" "}
            {parent?.doc_type === "order" ? "заявки" : parent?.doc_type === "shipment" ? "накладной" : "документа"}
            {" — "}
            <Link to="/invoices/$id" params={{ id: inv.parent_id }} className="text-primary hover:underline">
              {parent?.number ? `№ ${parent.number}` : "открыть"}
              {parent?.issue_date ? ` от ${dfmt.format(new Date(parent.issue_date))}` : ""}
            </Link>
          </p>
        )}
      </div>

      {/* Связанные документы: для заявки — с кнопками создания, для остальных — просто список */}
      {(isOrder || children.length > 0) && (
        <Card className="p-5 print:hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Связанные документы</h3>
            {isOrder && <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => createShipment.mutate()} disabled={createShipment.isPending || items.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Накладная
              </Button>
              <Button size="sm" variant="outline" onClick={() => createReceipt.mutate()} disabled={createReceipt.isPending}>
                <Plus className="h-4 w-4 mr-1" /> ПКО
              </Button>
            </div>}
          </div>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Создайте накладную для списания остатков или ПКО для квитанции об оплате.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Документ</TableHead>
                  <TableHead>№</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {children.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>{c.doc_type === "shipment" ? "Накладная" : c.doc_type === "order" ? "Заявка" : "ПКО/РКО"}</TableCell>
                    <TableCell>
                      <Link to="/invoices/$id" params={{ id: c.id }} className="text-primary hover:underline">{c.number}</Link>
                    </TableCell>
                    <TableCell>{dfmt.format(new Date(c.issue_date))}</TableCell>
                    <TableCell className="text-sm">
                      {c.doc_type === "shipment"
                        ? (c.status === "posted" ? "Проведена" : c.status === "cancelled" ? "Отменена" : "Черновик")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmt.format(Number(c.doc_type === "cash_receipt" ? (c.cash_received ?? 0) : c.total))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}


      {/* Оплаты по документу */}
      {!isPKO && (
        <PaymentsCard
          invoiceId={id}
          partnerId={inv.partner_id ?? null}
          workspaceId={wsId}
          total={Number(inv.total ?? 0)}
          direction={kind === "outgoing" ? "in" : "out"}
        />
      )}

      {/* Кто и когда менял документ */}
      <div className="print:hidden">
        <DocHistoryCard table="invoices" docId={id} />
      </div>

      {/* Edit form */}
      <div className="print:hidden space-y-5">
        <Card className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as any)} disabled={!editable}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outgoing">Расход (продажа)</SelectItem>
                  <SelectItem value="incoming">Приход (поступление)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Тип цены</Label>
              <Select value={priceTypeId ?? "__none"} onValueChange={applyPriceType} disabled={!editable || kind !== "outgoing"}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Не задан" /></SelectTrigger>
                <SelectContent>
                  {priceTypes.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет типов цен — добавьте в Настройках</div>}
                  {priceTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Номер</Label>
              <Input className="h-8" value={number} onChange={e => setNumber(e.target.value)} disabled={!editable} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Дата</Label>
              <Input className="h-8" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!editable} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{kind === "outgoing" ? "Покупатель" : "Поставщик"}</Label>
              <Select value={partnerId} onValueChange={setPartnerId} disabled={!editable}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Не выбран" /></SelectTrigger>
                <SelectContent>
                  {filteredPartners.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет контрагентов</div>}
                  {filteredPartners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {isShipment && (
            <div className="mt-3 max-w-xs space-y-1">
              <Label className="text-xs">Склад {inv.status === "posted" ? "" : "*"}</Label>
              <Select value={warehouseId || undefined} onValueChange={setWarehouseId} disabled={!editable || inv.status === "posted"}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                <SelectContent>
                  {warehouses.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет складов — добавьте в Настройках</div>}
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                При проведении накладной {kind === "outgoing" ? "товар спишется с этого склада" : "товар придёт на этот склад"}.
              </p>
            </div>
          )}
        </Card>

        {isPKO ? (
          <Card className="p-5">
            <h3 className="font-medium mb-4">Реквизиты квитанции</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Сумма, ₽</Label>
                <Input type="number" step="0.01" value={cashReceived}
                  onChange={e => setCashReceived(Number(e.target.value))} disabled={!editable} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Основание</Label>
                <Textarea rows={2} value={cashBasis} onChange={e => setCashBasis(e.target.value)} disabled={!editable} />
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="font-medium text-sm">Позиции</h3>
              <div className="flex gap-2">
                {editable && (
                  <ProductPicker
                    products={products as any}
                    kind={kind}
                    priceTypeId={priceTypeId}
              workspaceId={wsId}
                    onAdd={(picked: PickedItem[]) => setItems([...items, ...picked])}
                  />
                )}
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
                      {editable ? (
                        <button
                          type="button"
                          onClick={addItemAndPick}
                          className="w-full text-center text-muted-foreground py-6 hover:bg-accent hover:text-foreground transition-colors"
                        >
                          + Добавьте позицию
                        </button>
                      ) : (
                        <div className="text-center text-muted-foreground py-6">Нет позиций</div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      {editable ? (
                        <button
                          type="button"
                          className="xls-cell text-left hover:bg-accent"
                          onClick={() => setPickRow(idx)}
                        >
                          {it.name || <span className="text-muted-foreground">Выберите товар</span>}
                        </button>
                      ) : (it.name)}
                    </TableCell>
                    <TableCell>
                      <NumCell grid="inv" row={idx} col={0} step="0.001" className="xls-cell" value={it.quantity}
                        onCommit={(v) => updateItem(idx, { quantity: v })} disabled={!editable} />
                    </TableCell>
                    <TableCell>
                      <NumCell grid="inv" row={idx} col={1} step="0.01" className="xls-cell" value={it.price}
                        onCommit={(v) => updateItem(idx, { price: v })} disabled={!editable} />
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmt.format(it.quantity * it.price)}</TableCell>
                    <TableCell>
                      {editable && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-3 py-2 border-t flex justify-end items-center gap-3">
              <span className="text-xs text-muted-foreground">Итого:</span>
              <span className="text-base font-semibold">{fmt.format(total)}</span>
            </div>
          </Card>
        )}

        <Card className="p-3">
          <Label className="text-xs">Комментарий</Label>
          <Textarea className="mt-1 text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)} disabled={!editable} />
        </Card>

        <ProductPickerSingle
          open={pickRow !== null}
          onOpenChange={(v) => { if (!v) setPickRow(null); }}
          products={products as any}
          onPick={(productId) => { if (pickRow !== null) pickProduct(pickRow, productId); }}
        />
      </div>

      {/* Print layout (hidden on screen) */}
      {(printMode === "standard" || printMode === "invoice") && (
      <div className="invoice-print hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 900 }}>
        {printMode === "invoice" && orgAsParty && (
          <>
            <p className="text-center font-bold text-sm mb-2">Образец заполнения платежного поручения</p>
            <table className="w-full border-collapse text-sm mb-5">
              <tbody>
                <tr>
                  <td className="border border-black px-2 py-1 align-middle" style={{ width: "30%" }}>ИНН {orgAsParty.inn || "—"}</td>
                  <td className="border border-black px-2 py-1 align-middle" style={{ width: "20%" }}>КПП {orgAsParty.kpp || "—"}</td>
                  <td className="border border-black px-2 py-1 align-middle" rowSpan={2} style={{ width: "12%" }}>Сч. №</td>
                  <td className="border border-black px-2 py-1 align-middle font-semibold" rowSpan={2}>{orgAsParty.bank_account || "—"}</td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 align-top" colSpan={2}>
                    <div>Получатель</div>
                    <div className="font-semibold">{orgAsParty.name}</div>
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 align-top" colSpan={2} rowSpan={2}>
                    <div>Банк получателя</div>
                    <div className="font-semibold">{orgAsParty.bank_name || "—"}</div>
                  </td>
                  <td className="border border-black px-2 py-1 align-middle">БИК</td>
                  <td className="border border-black px-2 py-1 align-middle font-semibold">{orgAsParty.bank_bik || "—"}</td>
                </tr>
                <tr>
                  <td className="border border-black px-2 py-1 align-middle">Кор.сч.</td>
                  <td className="border border-black px-2 py-1 align-middle font-semibold">{orgAsParty.bank_corr_account || "—"}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <h1 className="text-center text-xl font-bold mb-5">{title}</h1>
        {supplierLine && (
          <p className="mb-2 text-sm"><span className="font-bold">Поставщик:</span> {supplierLine.name}
            {supplierLine.inn ? `, ИНН ${supplierLine.inn}` : ""}
            {supplierLine.kpp ? `, КПП ${supplierLine.kpp}` : ""}
            {supplierLine.address ? `, ${supplierLine.address}` : ""}
            {supplierLine.phone ? `, тел.: ${supplierLine.phone}` : ""}
            {supplierLine.bank_name ? `. Банк: ${supplierLine.bank_name}` : ""}
            {supplierLine.bank_bik ? `, БИК ${supplierLine.bank_bik}` : ""}
            {supplierLine.bank_account ? `, р/с ${supplierLine.bank_account}` : ""}
            {supplierLine.bank_corr_account ? `, к/с ${supplierLine.bank_corr_account}` : ""}
          </p>
        )}
        {buyerLine
          ? <p className="mb-4 text-sm"><span className="font-bold">Покупатель:</span> {buyerLine.name}
              {buyerLine.inn ? `, ИНН ${buyerLine.inn}` : ""}
              {buyerLine.kpp ? `, КПП ${buyerLine.kpp}` : ""}
              {buyerLine.address ? `, ${buyerLine.address}` : ""}
              {buyerLine.phone ? `, тел.: ${buyerLine.phone}` : ""}</p>
          : <p className="mb-4 text-sm"><span className="font-bold">Покупатель:</span> Частное лицо</p>}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th className="border border-black px-2 py-1 text-center w-10">№</th>
              <th className="border border-black px-2 py-1 text-center">Наименование товара, работ, услуг</th>
              <th className="border border-black px-2 py-1 text-center w-20">Ед. изм.</th>
              <th className="border border-black px-2 py-1 text-center w-20">Кол-во</th>
              <th className="border border-black px-2 py-1 text-center w-28">Цена</th>
              <th className="border border-black px-2 py-1 text-center w-32">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const goods = items.filter(it => (it.kind ?? "product") === "product");
              const services = items.filter(it => it.kind === "service");
              const goodsTotal = goods.reduce((s, i) => s + i.quantity * i.price, 0);
              const servicesTotal = services.reduce((s, i) => s + i.quantity * i.price, 0);
              const hasBoth = goods.length > 0 && services.length > 0;
              let n = 0;
              const renderRow = (it: Item, i: number) => {
                const p: any = products.find((x: any) => x.id === it.product_id);
                n += 1;
                return (
                  <tr key={`${it.kind}-${i}`}>
                    <td className="border border-black px-2 py-1 text-center">{n}</td>
                    <td className="border border-black px-2 py-1">{it.name}</td>
                    <td className="border border-black px-2 py-1 text-center">{p?.unit || (it.kind === "service" ? "усл" : "шт")}</td>
                    <td className="border border-black px-2 py-1 text-right">{it.quantity}</td>
                    <td className="border border-black px-2 py-1 text-right">{nfmt.format(it.price)}</td>
                    <td className="border border-black px-2 py-1 text-right">{nfmt.format(it.quantity * it.price)}</td>
                  </tr>
                );
              };
              return (
                <>
                  {hasBoth && (
                    <tr>
                      <td colSpan={6} className="px-2 py-1 font-bold uppercase">Товары</td>
                    </tr>
                  )}
                  {goods.map(renderRow)}
                  {hasBoth && goods.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-1 text-right font-bold">Итого по товарам:</td>
                      <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(goodsTotal)}</td>
                    </tr>
                  )}
                  {hasBoth && (
                    <tr>
                      <td colSpan={6} className="px-2 py-1 font-bold uppercase">Услуги</td>
                    </tr>
                  )}
                  {services.map(renderRow)}
                  {hasBoth && services.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-1 text-right font-bold">Итого по услугам:</td>
                      <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(servicesTotal)}</td>
                    </tr>
                  )}
                  <tr><td colSpan={5} className="px-2 py-1 text-right font-bold">Итого:</td>
                    <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(total)}</td></tr>
                  <tr><td colSpan={5} className="px-2 py-1 text-right font-bold">Без налога (НДС):</td>
                    <td className="border border-black px-2 py-1 text-right">---</td></tr>
                  <tr><td colSpan={5} className="px-2 py-1 text-right font-bold">Всего к оплате:</td>
                    <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(total)}</td></tr>
                </>
              );
            })()}
          </tbody>
        </table>
        <p className="mt-4 text-sm">Всего наименований {items.length}, на сумму {nfmt.format(total)} руб.</p>
        <p className="mt-1 text-sm font-bold">{amountInWords(total)}</p>
        {note && <p className="mt-4 text-sm"><span className="font-bold">Комментарий:</span> {note}</p>}
        <div className="mt-12 text-sm">
          <div className="font-bold mb-6">{kind === "outgoing" ? "Заказ принял:" : "Товар принял:"}</div>
          <div className="border-b border-black" style={{ width: 260 }} />
        </div>
      </div>
      )}

      {/* ПКО print layout (КО-1) */}
      {(printMode === "torg12" || printMode === "upd") && (() => {
        const printItems: PrintItem[] = items.map((it) => {
          const p: any = products.find((x: any) => x.id === it.product_id);
          return {
            name: it.name,
            unit: p?.unit || (it.kind === "service" ? "усл" : "шт"),
            quantity: it.quantity,
            price: it.price,
          };
        });
        return (
          <div className="invoice-print hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 1000 }}>
            {printMode === "torg12"
              ? <Torg12 supplier={supplierLine} buyer={buyerLine} number={cleanNumber} date={inv.issue_date} items={printItems} note={note} />
              : <Upd supplier={supplierLine} buyer={buyerLine} number={cleanNumber} date={inv.issue_date} items={printItems} note={note} />}
          </div>
        );
      })()}

      {printMode === "pko" && (
      <div className="invoice-print hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 900, fontSize: 12 }}>
        <div className="text-right text-xs mb-1">Унифицированная форма № КО-1<br/>Утверждена постановлением Госкомстата России от 18.08.98 № 88</div>
        <table className="w-full border-collapse text-xs mb-2">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 align-top w-1/2">
                <div>Организация</div>
                <div className="font-semibold">{orgAsParty?.name || "—"}</div>
              </td>
              <td className="border border-black px-2 py-1 align-top w-32 text-center">
                <div>Код по ОКПО</div>
                <div className="font-semibold">{myOrg?.okpo || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>
        <h1 className="text-center text-lg font-bold mt-4">ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР</h1>
        <table className="w-full border-collapse text-xs mt-2 mb-4">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 w-24">Номер документа</th>
              <th className="border border-black px-2 py-1 w-32">Дата составления</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 text-center">{cleanNumber}</td>
              <td className="border border-black px-2 py-1 text-center">{dfmt.format(new Date(inv.issue_date))}</td>
            </tr>
          </tbody>
        </table>

        <table className="w-full border-collapse text-xs mb-4">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1" colSpan={2}>Дебет</th>
              <th className="border border-black px-2 py-1" rowSpan={2}>Кредит</th>
              <th className="border border-black px-2 py-1" rowSpan={2}>Сумма,<br/>руб. коп.</th>
              <th className="border border-black px-2 py-1" rowSpan={2}>Код целевого<br/>назначения</th>
            </tr>
            <tr>
              <th className="border border-black px-2 py-1">Корреспондирующий<br/>счёт, субсчёт</th>
              <th className="border border-black px-2 py-1">Код аналитического<br/>учёта</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 text-center">50</td>
              <td className="border border-black px-2 py-1"></td>
              <td className="border border-black px-2 py-1 text-center">62</td>
              <td className="border border-black px-2 py-1 text-right font-semibold">{nfmt.format(cashReceived)}</td>
              <td className="border border-black px-2 py-1"></td>
            </tr>
          </tbody>
        </table>

        <div className="text-sm mb-2"><span className="font-bold">Принято от:</span> {partnerObj?.name || "—"}</div>
        <div className="text-sm mb-2"><span className="font-bold">Основание:</span> {cashBasis || "—"}</div>
        <div className="text-sm mb-2"><span className="font-bold">Сумма:</span> {amountInWords(cashReceived)}</div>
        <div className="text-sm mb-2"><span className="font-bold">В том числе:</span> без налога (НДС)</div>
        <div className="text-sm mb-4"><span className="font-bold">Приложение:</span> _____________________________________</div>

        <div className="grid grid-cols-2 gap-6 text-sm mt-6">
          <div>
            <div>Главный бухгалтер</div>
            <div className="border-b border-black mt-4" />
            <div className="text-xs text-center mt-1">подпись, расшифровка</div>
          </div>
          <div>
            <div>Получил кассир</div>
            <div className="border-b border-black mt-4" />
            <div className="text-xs text-center mt-1">подпись, расшифровка</div>
          </div>
        </div>

        <div className="border-t-2 border-dashed border-black my-6" />

        {/* Отрывная квитанция */}
        <div>
          <h2 className="text-center text-base font-bold">КВИТАНЦИЯ</h2>
          <p className="text-sm mt-1">к приходному кассовому ордеру № {cleanNumber} от {dfmt.format(new Date(inv.issue_date))}</p>
          <div className="text-sm mt-2"><span className="font-bold">Принято от:</span> {partnerObj?.name || "—"}</div>
          <div className="text-sm mt-1"><span className="font-bold">Основание:</span> {cashBasis || "—"}</div>
          <div className="text-sm mt-1"><span className="font-bold">Сумма:</span> {amountInWords(cashReceived)}</div>
          <div className="text-sm mt-1"><span className="font-bold">В том числе:</span> без налога (НДС)</div>
          <div className="grid grid-cols-3 gap-4 text-sm mt-6">
            <div>«___» __________ {new Date(inv.issue_date).getFullYear()} г.</div>
            <div className="text-center">М.П. (штампа)</div>
            <div></div>
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm mt-6">
            <div>
              <div>Главный бухгалтер</div>
              <div className="border-b border-black mt-4" />
            </div>
            <div>
              <div>Кассир</div>
              <div className="border-b border-black mt-4" />
            </div>
          </div>
        </div>
      </div>
      )}

      <style>{`
        @media print {
          @page { size: A4; margin: 15mm; }
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .invoice-print, .invoice-print * { visibility: visible !important; }
          .invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
