import { NumCell } from "@/components/NumCell";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { PartnerPicker } from "@/components/PartnerPicker";
import { PaymentsCard } from "@/components/PaymentsCard";
import { DocHistoryCard } from "@/components/DocHistoryCard";
import { KktReceiptButton } from "@/components/kkt-receipt-button";
import { invoiceSaveTx } from "@/lib/invoice-save.functions";
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { amountInWords } from "@/lib/amount-in-words";
import { Pko } from "@/components/print/Pko";
import { ProductPicker, type PickedItem } from "@/components/ProductPicker";
import { ProductPickerSingle } from "@/components/ProductPickerSingle";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { usePriceTypes, useMyPriceTypeId, priceOf } from "@/lib/price-types";
import { useOrganizations, pickOrg } from "@/lib/organizations";
import { Torg12 } from "@/components/print/Torg12";
import { Upd } from "@/components/print/Upd";
import type { PrintItem } from "@/components/print/print-types";
import { PrintHeader } from "@/components/print/PrintHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useDiscounts, grossSum, discountSum, netSum, discountLabel, type DiscountKind } from "@/lib/discounts";
import { DocTreeCard, loadChain } from "@/components/DocTreeCard";
import { docTitle as docTitleOf, docTitleAccusative, effectiveCashKind } from "@/lib/doc-tree";
import {
  VAT_MODES, VAT_RATES, splitVat, sumVat, toVatRate, vatRateId, defaultVatMode, defaultVatRate,
  type VatMode, type VatRate,
} from "@/lib/vat";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Документ — КабинетCRM" },
      { name: "description", content: "Просмотр, редактирование и печать заявки, накладной или кассового документа." },
      { property: "og:title", content: "Документ — КабинетCRM" },
      { property: "og:description", content: "Просмотр, редактирование и печать заявки, накладной или кассового документа." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
  vat_rate?: VatRate;
};
type DocType = "order" | "shipment" | "cash_receipt";
type PrintMode = "standard" | "invoice" | "pko" | "torg12" | "upd";


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
  // Юрлица базы; документ привязан к организации, от неё печать и чек
  const { data: orgs = [] } = useOrganizations(wsId);
  const [orgId, setOrgId] = useState<string>("");
  const myOrg = pickOrg(orgs, orgId || null);
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
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("card");

  // Автоподгонка ТОРГ-12 / УПД под один лист A4 (альбомная)
  const landscapeRef = useRef<HTMLDivElement | null>(null);
  const fitLandscape = useCallback(() => {
    const el = landscapeRef.current;
    if (!el) return;
    // печатная область A4 landscape при поле 8 мм ≈ 1062 x 726 px (96 dpi)
    const PAGE_W = 1062, PAGE_H = 720;
    el.style.transform = "none";
    el.style.width = "";
    const wasHidden = el.classList.contains("hidden");
    if (wasHidden) el.classList.remove("hidden");
    const prev = { position: el.style.position, left: el.style.left, top: el.style.top };
    el.style.position = "absolute";
    el.style.left = "-20000px";
    el.style.top = "0";
    el.style.width = `${PAGE_W}px`;
    const h = el.scrollHeight;
    el.style.position = prev.position;
    el.style.left = prev.left;
    el.style.top = prev.top;
    if (wasHidden) el.classList.add("hidden");
    const scale = h > 0 ? Math.min(1, PAGE_H / h) : 1;
    if (scale < 1) {
      el.style.width = `${100 / scale}%`;
      el.style.transformOrigin = "top left";
      el.style.transform = `scale(${scale})`;
    } else {
      el.style.width = "";
      el.style.transform = "none";
    }
  }, []);

  useEffect(() => {
    const after = () => {
      const el = landscapeRef.current;
      if (el) { el.style.transform = "none"; el.style.width = ""; }
    };
    window.addEventListener("beforeprint", fitLandscape);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", fitLandscape);
      window.removeEventListener("afterprint", after);
    };
  }, [fitLandscape]);

  const doPrint = (mode: PrintMode) => {
    setPrintMode(mode);
    setTimeout(() => {
      if (mode === "torg12" || mode === "upd") fitLandscape();
      window.print();
    }, 80);

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
    setPaymentMethod(inv.payment_method === "cash" ? "cash" : "card");
    setOrgId(inv.organization_id ?? "");
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


  // Вся цепочка документов: оплаты считаются по заявке и по её накладным/ордерам вместе.
  const { data: chain } = useQuery({
    queryKey: ["doc-chain", id],
    queryFn: () => loadChain(id),
  });
  const chainIds = (chain?.docs ?? []).map((d) => d.id);

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
      // Для кассовых ордеров вид документа должен соответствовать префиксу номера,
      // иначе ПКО может отображаться как РКО (или наоборот).
      const normalizedKind = isPKO
        ? ((effectiveCashKind("cash_receipt", kind, number) ?? kind) as "incoming" | "outgoing")
        : kind;

      const header = {
        kind: normalizedKind, number, issue_date: date, partner_id: partnerId || null, note: note || null,
        warehouse_id: isShipment ? (warehouseId || null) : null,
        cash_received: isPKO ? cashReceived : null,
        cash_basis: isPKO ? (cashBasis || null) : null,
        payment_method: paymentMethod,
        organization_id: orgId || null,
      };

      const rows = items.map(it => ({
        id: it.id ?? null,
        product_id: it.product_id, name: it.name,
        quantity: it.quantity, price: it.price, sum: lineNet(it),
        kind: it.kind ?? "product",
        discount_kind: it.discount_kind ?? "percent",
        discount_value: Number(it.discount_value) || 0,
        discount_name: it.discount_name ?? null,
      }));

      // Шапка и позиции сохраняются одной транзакцией: при ошибке документ
      // остаётся прежним, полусохранённых документов не бывает.
      const res: any = await invoiceSaveTx({ data: { invoiceId: id, header, items: rows } });
      if (res.error) throw new Error(res.error.message);

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
        number: `${inv!.kind === "incoming" ? "П" : "Н"}-${cleanNum}`,
        kind: inv!.kind,
        partner_id: inv!.partner_id,
        warehouse_id: defaultWh,
        issue_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        doc_type: "shipment",
        parent_id: id,
        note: `На основании заявки № ${cleanNum}`,
        organization_id: inv!.organization_id ?? null,
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
      qc.invalidateQueries({ queryKey: ["doc-chain"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["shipments"] });
      toast.success(inv?.kind === "incoming" ? "Поступление создано" : "Накладная создана");
      navigate({ to: "/invoices/$id", params: { id: newId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createReceipt = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const cleanNum = String(inv!.number).replace(/^№\s*/, "");
      const amount = Number(inv!.total) || total || 0;
      const payDate = new Date().toISOString().slice(0, 10);
      // Деньги по ордеру одновременно записываем как оплату документа,
      // иначе долг по накладной остаётся «неоплаченным».
      const { data: pay, error: payErr } = await (db as any).from("invoice_payments").insert({
        invoice_id: id,
        partner_id: inv!.partner_id,
        direction: inv!.kind === "outgoing" ? "in" : "out",
        amount,
        date: payDate,
        method: "cash",
        note: "Кассовый ордер",
        workspace_id: inv!.workspace_id ?? wsId,
        user_id: user.id,
      }).select("id").single();
      if (payErr) throw payErr;
      const { data: pko, error } = await (db as any).from("invoices").insert({
        user_id: user.id,
        workspace_id: inv!.workspace_id ?? wsId,
        // продажа → деньги приходят в кассу (ПКО), закупка → деньги уходят (РКО)
        number: `${inv!.kind === "outgoing" ? "ПКО" : "РКО"}-${cleanNum}`,
        kind: inv!.kind === "outgoing" ? "incoming" : "outgoing",
        partner_id: inv!.partner_id,
        issue_date: payDate,
        status: "draft",
        doc_type: "cash_receipt",
        parent_id: id,
        cash_received: amount,
        cash_basis: `Оплата по ${docTitleAccusative(inv!.doc_type, inv!.kind, inv!.number)} № ${cleanNum} от ${dfmt.format(new Date(inv!.issue_date))}`,
        organization_id: inv!.organization_id ?? null,
        source_payment_id: pay.id,
      }).select().single();
      if (error) {
        await (db as any).from("invoice_payments").delete().eq("id", pay.id);
        throw error;
      }
      return pko.id as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["invoice-children", id] });
      qc.invalidateQueries({ queryKey: ["doc-chain"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      toast.success(inv?.kind === "outgoing" ? "ПКО создан" : "РКО создан");
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
        organization_id: inv!.organization_id ?? null,
      }).select("id").single();
      if (error) throw error;
      const rows = items.map(it => ({
        invoice_id: doc.id, product_id: it.product_id, name: it.name,
        quantity: it.quantity, price: it.price,
        sum: netSum(it.quantity, it.price, it.discount_kind, it.discount_value),
        discount_kind: it.discount_kind ?? "percent",
        discount_value: Number(it.discount_value) || 0,
        discount_name: it.discount_name ?? null,
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
  const docTitle = docTitleOf(docType, kind, inv.is_return, inv.number);
  const cashKind = effectiveCashKind(docType, kind, inv.number) ?? kind;
  const title = printMode === "pko"
    ? `${cashKind === "outgoing" ? "Расходный" : "Приходный"} кассовый ордер № ${cleanNumber}`
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
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 rounded-t-lg border bg-muted/30 px-4 py-2.5 print:hidden flex-wrap">
        <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> К списку заявок
        </Link>
        <div className="flex gap-2 items-center flex-wrap">
          {null}

          {editable && <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" /> Сохранить</Button>}
          {isShipment && inv.status === "draft" && <Button variant="outline" onClick={() => setStatus.mutate("posted")}><CheckCircle2 className="h-4 w-4 mr-1" /> Провести</Button>}
          {isShipment && kind === "outgoing" && inv.status !== "cancelled" && (
            <KktReceiptButton
              wsId={wsId}
              orgId={orgId || inv.organization_id || null}
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
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" title="Печать"><Printer className="h-4 w-4 mr-1" /> Печать <ChevronDown className="h-4 w-4 ml-1" /></Button>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost">Ещё <ChevronDown className="h-4 w-4 ml-1" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isShipment && inv.status === "posted" && (
                <DropdownMenuItem onClick={() => setStatus.mutate("draft")}>
                  <FileEdit className="h-4 w-4 mr-2" /> Распровести
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => duplicate.mutate("copy")}>
                <Copy className="h-4 w-4 mr-2" /> Копия документа
              </DropdownMenuItem>
              {!isPKO && (
                <DropdownMenuItem onClick={() => duplicate.mutate("return")}>
                  <Copy className="h-4 w-4 mr-2" /> {kind === "outgoing" ? "Возврат от покупателя" : "Возврат поставщику"}
                </DropdownMenuItem>
              )}
              {inv.status !== "cancelled" && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    if (!confirm(`Отменить ${docTitleAccusative(docType, kind, inv.number)}?`)) return;
                    setStatus.mutate("cancelled", { onSuccess: () => navigate({ to: "/invoices" }) });
                  }}
                >
                  <XCircle className="h-4 w-4 mr-2" /> Отменить документ
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Header label */}
      <div className="-mt-4 border-x bg-card px-5 pb-3 pt-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-lg font-semibold leading-tight">
            {docTitle} № {cleanNumber}
          </h1>
          {isShipment && (
            <Badge variant={inv.status === "posted" ? "default" : inv.status === "draft" ? "secondary" : "destructive"}>
              {inv.status === "posted" ? "Проведена" : inv.status === "draft" ? "Черновик" : "Отменена"}
            </Badge>
          )}
          {statuses.length > 0 && (
            <Select value={inv.status_id ?? undefined} onValueChange={(v) => setStatusId.mutate(v)}>
              <SelectTrigger className="h-8 w-[170px]" title="Статус документа">
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
        </div>

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
            {docTitleOf(parent?.doc_type, parent?.kind, parent?.is_return, parent?.number).toLowerCase()}
            {" — "}
            <Link to="/invoices/$id" params={{ id: inv.parent_id }} className="text-primary hover:underline">
              {parent?.number ? `№ ${parent.number}` : "открыть"}
              {parent?.issue_date ? ` от ${dfmt.format(new Date(parent.issue_date))}` : ""}
            </Link>
          </p>
        )}
      </div>


      {/* Edit form */}
      <div className="-mt-4 overflow-hidden rounded-b-lg border bg-card print:hidden">
        <div className="border-t p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {isPKO ? (
              <div className="space-y-1">
                <Label className="text-xs">Вид кассового ордера</Label>
                <div className="h-8 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                  {docTitleOf("cash_receipt", kind, false, number)}
                  <span className="text-muted-foreground ml-2">
                    {effectiveCashKind("cash_receipt", kind, number) === "incoming" ? "(приход денег)" : "(расход денег)"}
                  </span>
                </div>
              </div>
            ) : (
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
            )}
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
          </div>
          <div className={`mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 ${orgs.length > 1 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {orgs.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Организация</Label>
                <Select value={orgId || myOrg?.id || ""} onValueChange={setOrgId} disabled={!editable}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Юрлицо" /></SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{kind === "outgoing" ? "Покупатель" : "Поставщик"}</Label>
              <PartnerPicker value={partnerId || null} onChange={setPartnerId} kind={kind === "outgoing" ? "customer" : "supplier"} disabled={!editable} />
            </div>
            {isShipment && kind === "outgoing" && (
              <div className="space-y-1">
                <Label className="text-xs">Оплата</Label>
                <Select value={paymentMethod} disabled={!editable} onValueChange={(v) => {
                  const m = v as "cash" | "card";
                  setPaymentMethod(m);
                  (db as any).from("invoices").update({ payment_method: m }).eq("id", id)
                    .then(() => qc.invalidateQueries({ queryKey: ["invoice", id] }));
                }}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="card">По терминалу</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {isShipment && (
              <div className="space-y-1">
                <Label className="text-xs">Склад {inv.status === "posted" ? "" : "*"}</Label>
                <Select value={warehouseId || undefined} onValueChange={setWarehouseId} disabled={!editable || inv.status === "posted"}>
                  <SelectTrigger className="h-8" title={kind === "outgoing" ? "При проведении товар спишется с этого склада" : "При проведении товар придёт на этот склад"}><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет складов — добавьте в Настройках</div>}
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {isPKO ? (
          <div className="border-t p-4">
            <h3 className="font-medium mb-3 text-sm">Реквизиты квитанции</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Сумма, ₽</Label>
                <Input className="h-8" type="number" step="0.01" value={cashReceived}
                  onChange={e => setCashReceived(Number(e.target.value))} disabled={!editable} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Основание</Label>
                <Input className="h-8" value={cashBasis} onChange={e => setCashBasis(e.target.value)} disabled={!editable} />
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden border-t">
            <div className="flex items-center justify-between bg-muted/30 px-4 py-2.5">
              <h3 className="font-display text-sm font-semibold">Позиции</h3>
              <div className="flex flex-wrap items-center gap-2">
                {editable && items.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8">
                        Скидка{selected.length ? ` (${selected.length})` : ""} <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {selected.length ? `Применить к отмеченным позициям: ${selected.length}` : "Применить ко всем позициям"}
                      </p>
                      {discountRefs.length > 0 && (
                        <Select value="" onValueChange={(v) => {
                          const d = discountRefs.find(x => x.id === v);
                          if (d) applyDiscount(d.kind, d.value, d.name);
                        }}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Из справочника скидок" /></SelectTrigger>
                          <SelectContent>
                            {discountRefs.map(d => (
                              <SelectItem key={d.id} value={d.id}>{d.name} — {discountLabel(d.kind, d.value)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex items-center gap-1">
                        <Select value={manualKind} onValueChange={(v) => setManualKind(v as DiscountKind)}>
                          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">%</SelectItem>
                            <SelectItem value="amount">₽</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input className="h-8 w-20 text-xs" placeholder="0" value={manualValue}
                          onChange={e => setManualValue(e.target.value)} />
                        <Button size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => applyDiscount(manualKind, Number(String(manualValue).replace(",", ".")) || 0, null)}>
                          Применить
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs"
                          onClick={() => applyDiscount("percent", 0, null)}>Снять</Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
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
                  {editable && (
                    <TableHead className="w-8">
                      <Checkbox
                        checked={items.length > 0 && selected.length === items.length}
                        onCheckedChange={(v) => setSelected(v ? items.map((_, i) => i) : [])}
                        aria-label="Отметить все позиции"
                      />
                    </TableHead>
                  )}
                  <TableHead>Товар</TableHead>
                  <TableHead className="w-24 text-right">Кол-во</TableHead>
                  <TableHead className="w-28 text-right">Цена</TableHead>
                  <TableHead className="w-36 text-right">Скидка</TableHead>
                  <TableHead className="w-32 text-right">Сумма</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 7 : 6} className="p-0">
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
                  <TableRow key={idx} data-selected={selected.includes(idx) || undefined} className={selected.includes(idx) ? "bg-accent/40" : undefined}>
                    {editable && (
                      <TableCell>
                        <Checkbox checked={selected.includes(idx)} onCheckedChange={() => toggleSel(idx)} aria-label="Отметить позицию" />
                      </TableCell>
                    )}
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
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <NumCell grid="inv" row={idx} col={2} step="0.01" className="xls-cell w-16" value={Number(it.discount_value) || 0}
                          onCommit={(v) => updateItem(idx, { discount_value: v })} disabled={!editable} />
                        <Select value={it.discount_kind === "amount" ? "amount" : "percent"}
                          onValueChange={(v) => updateItem(idx, { discount_kind: v as DiscountKind })}
                          disabled={!editable}>
                          <SelectTrigger className="h-7 w-14 text-xs px-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">%</SelectItem>
                            <SelectItem value="amount">₽</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {lineDiscount(it) > 0 && (
                        <div className="text-[11px] text-muted-foreground text-right mt-0.5" title={it.discount_name ?? undefined}>
                          −{fmt.format(lineDiscount(it))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {lineDiscount(it) > 0 && (
                        <div className="text-[11px] text-muted-foreground line-through">{fmt.format(lineGross(it))}</div>
                      )}
                      {fmt.format(lineNet(it))}
                    </TableCell>
                    <TableCell>
                      {editable && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-3 py-2 border-t flex flex-wrap justify-end items-center gap-x-4 gap-y-1">
              {totalDiscount > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">Сумма без скидки: {fmt.format(totalGross)}</span>
                  <span className="text-xs text-muted-foreground">Скидка: −{fmt.format(totalDiscount)}</span>
                </>
              )}
              <span className="text-xs text-muted-foreground">Итого:</span>
              <span className="text-base font-semibold">{fmt.format(total)}</span>
            </div>
          </div>
        )}

        <div className="border-t p-4">
          <Label className="text-xs">Комментарий</Label>
          <Textarea className="mt-1 min-h-16 resize-y text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)} disabled={!editable} />
        </div>

        <ProductPickerSingle
          open={pickRow !== null}
          onOpenChange={(v) => { if (!v) setPickRow(null); }}
          products={products as any}
          onPick={(productId) => { if (pickRow !== null) pickProduct(pickRow, productId); }}
        />
      </div>

      {/* Служебные блоки: связи, оплаты, история — ниже основной формы */}
      <div className="print:hidden space-y-3">
        <DocTreeCard
          docId={id}
          hint={
            isOrder
              ? (kind === "incoming"
                  ? "Создайте на основании заявки поступление товара — по его ценам считается себестоимость — и РКО на оплату поставщику."
                  : "Создайте на основании заявки расходную накладную для списания остатков и ПКО на оплату.")
              : isShipment
                ? "Создайте на основании этого документа кассовый ордер на оплату."
                : "Связанных документов пока нет."
          }
          actions={
            (isOrder || isShipment) && inv.status !== "cancelled" ? (
              <div className="flex flex-wrap gap-2">
                {isOrder && (
                  <Button size="sm" variant="outline" onClick={() => createShipment.mutate()} disabled={createShipment.isPending || items.length === 0}>
                    <Plus className="h-4 w-4 mr-1" /> {kind === "incoming" ? "Поступление товара" : "Расходная накладная"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => createReceipt.mutate()} disabled={createReceipt.isPending}>
                  <Plus className="h-4 w-4 mr-1" /> {kind === "incoming" ? "РКО (оплата поставщику)" : "ПКО (оплата от покупателя)"}
                </Button>
              </div>
            ) : null
          }
        />

        {!isPKO && (
          <PaymentsCard
            invoiceId={id}
            partnerId={inv.partner_id ?? null}
            workspaceId={wsId}
            orgId={orgId || inv.organization_id || null}
            total={Number(inv.total ?? 0)}
            direction={kind === "outgoing" ? "in" : "out"}
            invoiceNumber={cleanNumber}
            chainIds={chainIds}
          />

        )}

        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground select-none">
            История изменений
          </summary>
          <div className="px-1 pb-1">
            <DocHistoryCard table="invoices" docId={id} />
          </div>
        </details>
      </div>

      {/* Print layout (hidden on screen) */}
      {(printMode === "standard" || printMode === "invoice") && (
      <div className="invoice-print hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 900 }}>
        <PrintHeader org={myOrg as any} />
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
            {printMode === "invoice" && supplierLine.inn ? `, ИНН ${supplierLine.inn}` : ""}
            {printMode === "invoice" && supplierLine.kpp ? `, КПП ${supplierLine.kpp}` : ""}
          </p>
        )}
        <p className="mb-4 text-sm"><span className="font-bold">Покупатель:</span> {buyerLine
          ? <>
              {buyerLine.name}
              {printMode === "invoice" && buyerLine.inn ? `, ИНН ${buyerLine.inn}` : ""}
              {printMode === "invoice" && buyerLine.kpp ? `, КПП ${buyerLine.kpp}` : ""}
            </>
          : "Частное лицо"}</p>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th className="border border-black px-2 py-1 text-center w-10">№</th>
              <th className="border border-black px-2 py-1 text-center">Наименование товара, работ, услуг</th>
              <th className="border border-black px-2 py-1 text-center w-20">Ед. изм.</th>
              <th className="border border-black px-2 py-1 text-center w-20">Кол-во</th>
              <th className="border border-black px-2 py-1 text-center w-28">Цена</th>
              {totalDiscount > 0 && <th className="border border-black px-2 py-1 text-center w-24">Скидка</th>}
              {totalDiscount > 0 && <th className="border border-black px-2 py-1 text-center w-28">Сумма без скидки</th>}
              <th className="border border-black px-2 py-1 text-center w-32">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const goods = items.filter(it => (it.kind ?? "product") === "product");
              const services = items.filter(it => it.kind === "service");
              const goodsTotal = goods.reduce((s, i) => s + lineNet(i), 0);
              const servicesTotal = services.reduce((s, i) => s + lineNet(i), 0);
              const cols = totalDiscount > 0 ? 8 : 6;
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
                    {totalDiscount > 0 && (
                      <td className="border border-black px-2 py-1 text-right">
                        {lineDiscount(it) > 0 ? nfmt.format(lineDiscount(it)) : "—"}
                      </td>
                    )}
                    {totalDiscount > 0 && (
                      <td className="border border-black px-2 py-1 text-right">{nfmt.format(lineGross(it))}</td>
                    )}
                    <td className="border border-black px-2 py-1 text-right">{nfmt.format(lineNet(it))}</td>
                  </tr>
                );
              };
              return (
                <>
                  {hasBoth && (
                    <tr>
                      <td colSpan={cols} className="px-2 py-1 font-bold uppercase">Товары</td>
                    </tr>
                  )}
                  {goods.map(renderRow)}
                  {hasBoth && goods.length > 0 && (
                    <tr>
                      <td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Итого по товарам:</td>
                      <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(goodsTotal)}</td>
                    </tr>
                  )}
                  {hasBoth && (
                    <tr>
                      <td colSpan={cols} className="px-2 py-1 font-bold uppercase">Услуги</td>
                    </tr>
                  )}
                  {services.map(renderRow)}
                  {hasBoth && services.length > 0 && (
                    <tr>
                      <td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Итого по услугам:</td>
                      <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(servicesTotal)}</td>
                    </tr>
                  )}
                  {totalDiscount > 0 && (
                    <>
                      <tr><td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Сумма без скидки:</td>
                        <td className="border border-black px-2 py-1 text-right">{nfmt.format(totalGross)}</td></tr>
                      <tr><td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Скидка:</td>
                        <td className="border border-black px-2 py-1 text-right">−{nfmt.format(totalDiscount)}</td></tr>
                    </>
                  )}
                  <tr><td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Итого:</td>
                    <td className="border border-black px-2 py-1 text-right font-bold">{nfmt.format(total)}</td></tr>
                  <tr><td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Без налога (НДС):</td>
                    <td className="border border-black px-2 py-1 text-right">---</td></tr>
                  <tr><td colSpan={cols - 1} className="px-2 py-1 text-right font-bold">Всего к оплате:</td>
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
            price: it.quantity ? Math.round((netSum(it.quantity, it.price, it.discount_kind, it.discount_value) / it.quantity) * 100) / 100 : it.price,
          };
        });
        return (
          <div ref={landscapeRef} className="invoice-print invoice-print-landscape hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 1000 }}>
            <PrintHeader org={myOrg as any} />
            {printMode === "torg12"
              ? <Torg12 supplier={supplierLine} buyer={buyerLine} number={cleanNumber} date={inv.issue_date} items={printItems} note={note} />
              : <Upd supplier={supplierLine} buyer={buyerLine} number={cleanNumber} date={inv.issue_date} items={printItems} note={note} />}
          </div>
        );
      })()}

      {printMode === "pko" && (
      <div className="invoice-print hidden print:block bg-white text-black mx-auto" style={{ maxWidth: 800 }}>
        <PrintHeader org={myOrg as any} />
        <Pko
          org={myOrg as any}
          number={cleanNumber}
          date={inv.issue_date}
          partnerName={partnerObj?.name || ""}
          amount={cashReceived}
          basis={cashBasis || ""}
        />
      </div>
      )}

      <style>{`
        @page { size: ${printMode === "torg12" || printMode === "upd" ? "A4 landscape" : "A4 portrait"}; margin: ${printMode === "torg12" || printMode === "upd" ? "8mm" : "10mm"}; }
        @media print {
          .invoice-print-landscape { max-width: none !important; }
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .invoice-print, .invoice-print * { visibility: visible !important; }
          .invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
