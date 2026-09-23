// КУДиР (УСН): доходы и расходы по дате денег, с выбором «все документы»
// или «только с чеками», печать по форме приказа ФНС № ЕА-7-3/816@.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookText, Download, Plus, Printer, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { downloadCsv } from "@/lib/export-csv";
import {
  buildContribBook, buildKudir, filterKudirByMode, printKudir,
  CONTRIB_KINDS, CONTRIB_LABEL,
  type KudirContrib, type KudirContribKind, type KudirMode, type KudirRow,
} from "@/lib/kudir";
import { useOrganizations, useMyOrgId, pickOrg } from "@/lib/organizations";
import { isAccounted } from "@/lib/accounting";
import { useViewLog } from "@/hooks/use-view-log";
import { useFeature } from "@/hooks/use-billing";
import { FeatureLock } from "@/components/FeatureLock";


export const Route = createFileRoute("/_authenticated/reports/kudir")({
  head: () => ({
    meta: [
      { title: "КУДиР — книга учёта доходов и расходов — КабинетCRM" },
      { name: "description", content: "КУДиР при УСН: доходы и расходы по первичным документам, итоги за кварталы, печать и выгрузка в Excel." },
      { property: "og:title", content: "КУДиР — книга учёта доходов и расходов" },
      { property: "og:description", content: "Книга учёта доходов и расходов при УСН с итогами по кварталам." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KudirPageGate,
});

const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ruDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
const ROMAN = ["I", "II", "III", "IV"];

function KudirPage() {
  useViewLog("kudir");
  const wsId = useActiveWorkspaceId();
  // Фильтры сохраняются между переходами по меню
  const [year, setYear] = usePersistentState<number>("kudir.year", new Date().getFullYear());
  const [mode, setMode] = usePersistentState<KudirMode>("kudir.mode", "all");
  const [object, setObject] = usePersistentState<"income" | "income_minus">("kudir.object", "income");
  /** Режим книги: УСН — доходы и расходы, ПСН — только доходы. */
  const [regime, setRegime] = usePersistentState<"usn" | "psn" | null>("kudir.regime", null);

  // Книга формируется по выбранному юрлицу (по умолчанию — юрлицо текущего входа)
  const { data: orgs = [] } = useOrganizations(wsId);
  const { data: myOrgId } = useMyOrgId(wsId);
  const [orgSel, setOrgSel] = usePersistentState<string>("kudir.org", "");
  const org = pickOrg(orgs, orgSel || myOrgId || null) as any;
  const effOrgId: string | null = org?.id ?? null;

  // По умолчанию режим берём из системы налогообложения организации.
  const orgRegime: "usn" | "psn" = (org as any)?.taxation_system === "psn" ? "psn" : "usn";
  const activeRegime = regime ?? orgRegime;
  const isPsn = activeRegime === "psn";

  // Данные патента для шапки книги (номер, срок, счета) — храним в базе данных.
  const [patent, setPatent] = useState<{ number: string; from: string; to: string; accounts: string } | null>(null);

  // Раздел IV: уплаченные взносы. Храним в настройках базы данных.
  const qc = useQueryClient();
  const { data: contribs = [] } = useQuery<KudirContrib[]>({
    queryKey: ["kudir-contribs", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await (db as any).from("workspaces").select("*").eq("id", wsId).maybeSingle();
      const list = (data as any)?.kudir_contributions;
      return Array.isArray(list) ? (list as KudirContrib[]) : [];
    },
  });

  const saveContribs = useMutation({
    mutationFn: async (list: KudirContrib[]) => {
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (db as any).from("workspaces").update({ kudir_contributions: list }).eq("id", wsId);
      if (error) throw error;
      return list;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kudir-contribs", wsId] }),
    onError: (e: any) => toast.error(e?.message ?? "Не удалось сохранить взносы"),
  });

  // Реквизиты патента для шапки книги учёта доходов на ПСН.
  const { data: savedPatent } = useQuery({
    queryKey: ["kudir-patent", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await (db as any).from("workspaces").select("*").eq("id", wsId).maybeSingle();
      const p = (data as any)?.kudir_patent;
      return (p && typeof p === "object" ? p : {}) as { number?: string; from?: string; to?: string; accounts?: string };
    },
  });

  const patentValue = patent ?? {
    number: savedPatent?.number ?? "",
    from: savedPatent?.from ?? "",
    to: savedPatent?.to ?? "",
    accounts: savedPatent?.accounts ?? "",
  };

  const savePatent = useMutation({
    mutationFn: async (p: typeof patentValue) => {
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (db as any).from("workspaces").update({ kudir_patent: p }).eq("id", wsId);
      if (error) throw error;
      return p;
    },
    onSuccess: () => {
      toast.success("Данные патента сохранены");
      qc.invalidateQueries({ queryKey: ["kudir-patent", wsId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Не удалось сохранить данные патента"),
  });

  const [form, setForm] = useState<{ date: string; doc: string; period: string; kind: KudirContribKind; amount: string }>({
    date: new Date().toISOString().slice(0, 10),
    doc: "",
    period: "",
    kind: "opc",
    amount: "",
  });

  const addContrib = () => {
    const amount = Number(String(form.amount).replace(",", "."));
    if (!form.date || !amount) {
      toast.error("Укажите дату и сумму взноса");
      return;
    }
    const row: KudirContrib = {
      id: crypto.randomUUID(),
      date: form.date,
      doc: form.doc || undefined,
      period: form.period || undefined,
      kind: form.kind,
      amount: Math.round(amount * 100) / 100,
    };
    saveContribs.mutate([...contribs, row]);
    setForm((f) => ({ ...f, doc: "", amount: "" }));
  };



  const { data: rows = [], isLoading } = useQuery<KudirRow[]>({
    queryKey: ["kudir", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const [{ data: pays }, { data: invs }] = await Promise.all([
        (db as any).from("invoice_payments")
          .select("id,invoice_id,partner_id,amount,date,direction,method,note")
          .eq("workspace_id", wsId),
        (db as any).from("invoices")
          .select("id,number,kind,doc_type,total,cash_received,issue_date,note,fiscal,status,is_return,organization_id,vat_mode,vat_total,partner:partners(name)")
          .eq("workspace_id", wsId),
      ]);

      // При НДС (ОСН, УСН с НДС) в книгу попадает сумма без налога:
      // НДС — не доход и не расход налогоплательщика.
      const exVat = (amount: number, inv: any) => {
        const vat = Number(inv?.vat_total ?? 0);
        const tot = Number(inv?.total ?? 0);
        if (!inv || inv.vat_mode === "none" || !vat || !tot) return amount;
        return Math.round(amount * (1 - vat / tot) * 100) / 100;
      };
      const vatNote = (inv: any) => (Number(inv?.vat_total ?? 0) && inv?.vat_mode !== "none" ? " (без НДС)" : "");

      const byId = new Map<string, any>();
      for (const i of (invs ?? []) as any[]) byId.set(String(i.id), i);
      const out: KudirRow[] = [];

      // 1. Оплаты по накладным — доход или расход по дате денег (кассовый метод).
      for (const p of (pays ?? []) as any[]) {
        const amount = Number(p.amount || 0);
        if (!amount) continue;
        const inv = p.invoice_id ? byId.get(String(p.invoice_id)) : null;
        if (inv && !isAccounted(inv)) continue;
        const f = inv?.fiscal;
        const receipt = !!(f?.receiptNumber || f?.fiscalDocNumber);
        const isIncome = (p.direction ?? "in") === "in";
        const docLabel = inv
          ? `${ruDate(String(p.date ?? inv.issue_date ?? ""))} № ${inv.number ?? ""}`
          : `${ruDate(String(p.date ?? ""))} оплата`;
        out.push({
          id: `p-${p.id}`,
          date: String(p.date ?? inv?.issue_date ?? "").slice(0, 10),
          doc: docLabel,
          content: (isIncome
            ? `Поступление оплаты от покупателя${inv?.partner?.name ? ` ${inv.partner.name}` : ""}`
            : `Оплата поставщику${inv?.partner?.name ? ` ${inv.partner.name}` : ""}`) + vatNote(inv),
          income: isIncome ? exVat(amount, inv) : 0,
          expense: isIncome ? 0 : exVat(amount, inv),
          hasReceipt: receipt,
          receiptNumber: f?.receiptNumber ?? f?.fiscalDocNumber ?? null,
          orgId: inv?.organization_id ?? null,
        });
      }

      // 2. Кассовые ордера ПКО/РКО без привязки к оплате накладной.
      for (const i of (invs ?? []) as any[]) {
        if (i.doc_type !== "cash_receipt" || !isAccounted(i)) continue;
        const amount = Number(i.cash_received ?? i.total ?? 0);
        if (!amount) continue;
        const isIncome = i.kind === "incoming";
        const f = i.fiscal;
        out.push({
          id: `c-${i.id}`,
          date: String(i.issue_date ?? "").slice(0, 10),
          doc: `${ruDate(String(i.issue_date ?? ""))} № ${i.number ?? ""}`,
          content: i.note || (isIncome ? "Поступление в кассу" : "Выдача из кассы"),
          income: isIncome ? amount : 0,
          expense: isIncome ? 0 : amount,
          hasReceipt: !!(f?.receiptNumber || f?.fiscalDocNumber),
          receiptNumber: f?.receiptNumber ?? f?.fiscalDocNumber ?? null,
          orgId: i.organization_id ?? null,
        });
      }

      // 3. Продажи с пробитым чеком, по которым оплата отдельно не записана.
      const paidInvoices = new Set((pays ?? []).map((p: any) => String(p.invoice_id ?? "")));
      for (const i of (invs ?? []) as any[]) {
        if (i.doc_type !== "shipment" || i.kind !== "outgoing" || !isAccounted(i)) continue;
        const f = i.fiscal;
        if (!(f?.receiptNumber || f?.fiscalDocNumber)) continue;
        if (paidInvoices.has(String(i.id))) continue;
        const amount = Number(f.total ?? i.total ?? 0);
        if (!amount) continue;
        out.push({
          id: `s-${i.id}`,
          date: String(i.issue_date ?? "").slice(0, 10),
          doc: `${ruDate(String(i.issue_date ?? ""))} № ${i.number ?? ""}`,
          content: (i.is_return
            ? "Возврат покупателю по чеку"
            : `Выручка по чеку${i.partner?.name ? ` · ${i.partner.name}` : ""}`) + vatNote(i),
          income: i.is_return ? 0 : exVat(amount, i),
          expense: i.is_return ? exVat(amount, i) : 0,
          hasReceipt: true,
          receiptNumber: f.receiptNumber ?? f.fiscalDocNumber ?? null,
          orgId: i.organization_id ?? null,
        });
      }

      return out.filter((r) => r.date);
    },
  });

  // На патенте в книге учитываются только доходы — расходные операции не включаются.
  const selected = useMemo(() => {
    const byOrg = effOrgId ? rows.filter((r) => (r.orgId ?? null) === effOrgId) : rows;
    const byMode = filterKudirByMode(byOrg, mode);
    return isPsn ? byMode.filter((r) => r.income > 0).map((r) => ({ ...r, expense: 0 })) : byMode;
  }, [rows, mode, isPsn, effOrgId]);
  const book = useMemo(() => buildKudir(selected, year), [selected, year]);
  const contribBook = useMemo(() => buildContribBook(contribs, year), [contribs, year]);

  const years = useMemo(() => {
    const set = new Set<number>(rows.map((r) => Number(r.date.slice(0, 4))).filter(Boolean));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [rows]);

  const flat = book.quarters.flatMap((q) =>
    q.rows.map((r) => ({
      quarter: `${ROMAN[q.quarter - 1]} квартал`,
      no: r.no,
      doc: r.doc,
      content: r.content,
      income: r.income,
      expense: r.expense,
      receipt: r.hasReceipt ? `№ ${r.receiptNumber ?? ""}`.trim() : "нет",
    })),
  );

  const exportExcel = () =>
    downloadCsv(
      isPsn ? `книга-доходов-псн-${year}` : `кудир-${year}`,
      flat,
      [
        { header: "Квартал", value: (r) => r.quarter },
        { header: "№ п/п", value: (r) => r.no },
        { header: "Дата и номер первичного документа", value: (r) => r.doc },
        { header: "Содержание операции", value: (r) => r.content },
        { header: "Доходы", value: (r) => r.income },
        ...(isPsn ? [] : [{ header: "Расходы", value: (r: (typeof flat)[number]) => r.expense }]),
        { header: "Чек", value: (r) => r.receipt },
      ],
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2">
          <BookText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{isPsn ? "Книга учёта доходов (патент)" : "КУДиР"}</h1>
          <p className="text-sm text-muted-foreground">
            {isPsn
              ? "Книга учёта доходов ИП на патенте (приложение № 3 к приказу ФНС № ЕА-7-3/816@): только доходы по дате денег, итоги по кварталам."
              : "Книга учёта доходов и расходов при УСН (приказ ФНС № ЕА-7-3/816@): операции по дате денег, итоги по кварталам."}
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportExcel} disabled={!flat.length}>
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
        <Button
          disabled={!flat.length && !(isPsn ? 0 : contribBook.total)}
          onClick={() =>
            printKudir(
              book,
              {
                name: org?.name ?? "",
                inn: org?.inn ?? "",
                kpp: org?.kpp ?? "",
                legal_address: org?.legal_address ?? "",
                director_name: org?.director_name ?? "",
              },
              {
                mode,
                objectIncomeOnly: isPsn || object === "income",
                contribs: isPsn ? undefined : contribBook,
                regime: isPsn ? "psn" : "usn",
                patentNumber: patentValue.number,
                patentFrom: patentValue.from,
                patentTo: patentValue.to,
                bankAccounts: patentValue.accounts,
              },
            )
          }
        >

          <Printer className="h-4 w-4 mr-1" /> {isPsn ? "Печать книги доходов" : "Печать КУДиР"}
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {orgs.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Юрлицо</Label>
              <Select value={effOrgId ?? ""} onValueChange={setOrgSel}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Год</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Система налогообложения</Label>
            <Select value={activeRegime} onValueChange={(v) => setRegime(v as "usn" | "psn")}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="usn">УСН — книга доходов и расходов</SelectItem>
                <SelectItem value="psn">Патент — книга учёта доходов</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Какие документы включать</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as KudirMode)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все документы</SelectItem>
                <SelectItem value="receipts">Только с чеками</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isPsn && (
            <div className="space-y-1">
              <Label className="text-xs">Объект налогообложения</Label>
              <Select value={object} onValueChange={(v) => setObject(v as "income" | "income_minus")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Доходы</SelectItem>
                  <SelectItem value="income_minus">Доходы минус расходы</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {isPsn
            ? "На патенте учитываются только доходы по дате денег: оплаты от покупателей, приходные кассовые ордера и продажи с пробитым чеком. Расходы и страховые взносы в книгу не включаются."
            : "Доходы и расходы попадают в книгу по дате денег: оплаты по накладным, приходные и расходные кассовые ордера, а также продажи с пробитым чеком, по которым оплата отдельно не записана."}
        </p>
      </Card>

      {isPsn && (
        <Card className="p-4 space-y-3 border-t-2 border-t-amber-500/60">
          <div>
            <h2 className="text-lg font-semibold">Данные патента</h2>
            <p className="text-sm text-muted-foreground">Печатаются в шапке книги учёта доходов.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Номер патента</Label>
              <Input className="h-9" value={patentValue.number}
                onChange={(e) => setPatent({ ...patentValue, number: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Патент действует с</Label>
              <Input type="date" className="h-9" value={patentValue.from}
                onChange={(e) => setPatent({ ...patentValue, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">по</Label>
              <Input type="date" className="h-9" value={patentValue.to}
                onChange={(e) => setPatent({ ...patentValue, to: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Счета в банках</Label>
              <div className="flex gap-2">
                <Input className="h-9" placeholder="40802… , Сбербанк" value={patentValue.accounts}
                  onChange={(e) => setPatent({ ...patentValue, accounts: e.target.value })} />
                <Button className="h-9" variant="outline" onClick={() => savePatent.mutate(patentValue)} disabled={savePatent.isPending}>
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-emerald-600 dark:text-emerald-400">Доходы за год: <b>{fmt.format(book.income)} ₽</b></span>
        {!isPsn && object === "income_minus" && (
          <>
            <span className="text-destructive">Расходы за год: <b>{fmt.format(book.expense)} ₽</b></span>
            <span>Налоговая база: <b>{fmt.format(Math.max(0, book.base))} ₽</b></span>
          </>
        )}
      </div>

      <Card className="p-0 overflow-x-auto border-t-2 border-t-emerald-500/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">№ п/п</TableHead>
              <TableHead>Дата и номер документа</TableHead>
              <TableHead>Содержание операции</TableHead>
              <TableHead>Чек</TableHead>
              <TableHead className="text-right">Доходы</TableHead>
              {!isPsn && <TableHead className="text-right">Расходы</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!flat.length && (
              <TableRow>
                <TableCell colSpan={isPsn ? 5 : 6} className="text-center text-muted-foreground py-10">
                  {isLoading ? "Загрузка…" : "За выбранный год операций нет"}
                </TableCell>
              </TableRow>
            )}
            {book.quarters.filter((q) => q.rows.length).map((q) => (
              <Fragment key={q.quarter}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={isPsn ? 5 : 6} className="font-medium">{ROMAN[q.quarter - 1]} квартал {year} года</TableCell>
                </TableRow>
                {q.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.no}</TableCell>
                    <TableCell>{r.doc}</TableCell>
                    <TableCell>{r.content}</TableCell>
                    <TableCell>
                      {r.hasReceipt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <Receipt className="h-3.5 w-3.5" /> № {r.receiptNumber ?? "—"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">без чека</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.income ? fmt.format(r.income) : ""}</TableCell>
                    {!isPsn && <TableCell className="text-right">{r.expense ? fmt.format(r.expense) : ""}</TableCell>}
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={4}>Итого за {ROMAN[q.quarter - 1]} квартал · {q.ytdLabel} {fmt.format(q.incomeYtd)} ₽</TableCell>
                  <TableCell className="text-right">{fmt.format(q.income)}</TableCell>
                  {!isPsn && <TableCell className="text-right">{fmt.format(q.expense)}</TableCell>}
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Раздел IV — уплаченные страховые взносы и иные платежи по п. 3.1 ст. 346.21 НК РФ (только УСН) */}
      {!isPsn && (
      <Card className="p-4 space-y-4 border-t-2 border-t-sky-500/60">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h2 className="text-lg font-semibold">Раздел IV. Страховые взносы</h2>
            <p className="text-sm text-muted-foreground">
              Уплаченные взносы и пособия, уменьшающие налог при УСН «доходы». Вносятся по дате уплаты.
            </p>
          </div>
          <div className="ml-auto text-sm">
            Итого за {year} год: <b>{fmt.format(contribBook.total)} ₽</b>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-xs">Дата уплаты</Label>
            <Input type="date" className="h-9" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Вид платежа</Label>
            <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v as KudirContribKind }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTRIB_KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Документ</Label>
            <Input className="h-9" placeholder="платёжка № 15" value={form.doc} onChange={(e) => setForm((f) => ({ ...f, doc: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Период уплаты</Label>
            <Input className="h-9" placeholder="I квартал 2026" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Сумма, ₽</Label>
            <div className="flex gap-2">
              <Input className="h-9" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              <Button className="h-9" onClick={addContrib} disabled={saveContribs.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">№</TableHead>
                <TableHead>Дата и номер документа</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Вид платежа</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!contribBook.total && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    За {year} год взносы не внесены
                  </TableCell>
                </TableRow>
              )}
              {contribBook.quarters.filter((q) => q.rows.length).map((q) => (
                <Fragment key={q.quarter}>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={6} className="font-medium">{ROMAN[q.quarter - 1]} квартал {year} года</TableCell>
                  </TableRow>
                  {q.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.no}</TableCell>
                      <TableCell>{ruDate(r.date)}{r.doc ? ` № ${r.doc}` : ""}</TableCell>
                      <TableCell>{r.period ?? ""}</TableCell>
                      <TableCell>{CONTRIB_LABEL[r.kind]}</TableCell>
                      <TableCell className="text-right">{fmt.format(r.amount)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => saveContribs.mutate(contribs.filter((c) => c.id !== r.id))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={4}>Итого за {ROMAN[q.quarter - 1]} квартал · {q.ytdLabel} {fmt.format(q.totalYtd)} ₽</TableCell>
                    <TableCell className="text-right">{fmt.format(q.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        {!!contribBook.total && (
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                `кудир-раздел-4-${year}`,
                contribBook.quarters.flatMap((q) =>
                  q.rows.map((r) => ({
                    quarter: `${ROMAN[q.quarter - 1]} квартал`,
                    no: r.no,
                    doc: `${ruDate(r.date)}${r.doc ? ` № ${r.doc}` : ""}`,
                    period: r.period ?? "",
                    kind: CONTRIB_LABEL[r.kind],
                    amount: r.amount,
                  })),
                ),
                [
                  { header: "Квартал", value: (r) => r.quarter },
                  { header: "№ п/п", value: (r) => r.no },
                  { header: "Дата и номер документа", value: (r) => r.doc },
                  { header: "Период уплаты", value: (r) => r.period },
                  { header: "Вид платежа", value: (r) => r.kind },
                  { header: "Сумма", value: (r) => r.amount },
                ],
              )
            }
          >
            <Download className="h-4 w-4 mr-1" /> Excel раздела IV
          </Button>
        )}
      </Card>
      )}
    </div>

  );
}

/** Раздел доступен не на всех тарифах. */
function KudirPageGate() {
  const gate = useFeature("kudir");
  if (gate.loading) return <div className="p-4 text-sm text-muted-foreground">Загрузка…</div>;
  if (!gate.allowed) return <FeatureLock feature="kudir" planLabel={gate.planLabel} />;
  return <KudirPage />;
}
