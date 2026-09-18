// КУДиР (УСН): доходы и расходы по дате денег, с выбором «все документы»
// или «только с чеками», печать по форме приказа ФНС № ЕА-7-3/816@.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookText, Download, Printer, Receipt } from "lucide-react";
import { downloadCsv } from "@/lib/export-csv";
import { buildKudir, filterKudirByMode, printKudir, type KudirMode, type KudirRow } from "@/lib/kudir";

export const Route = createFileRoute("/_authenticated/cash/kudir")({
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
  component: KudirPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ruDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
const ROMAN = ["I", "II", "III", "IV"];

function KudirPage() {
  const wsId = useActiveWorkspaceId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [mode, setMode] = useState<KudirMode>("all");
  const [object, setObject] = useState<"income" | "income_minus">("income");

  const { data: org } = useQuery({
    queryKey: ["org-kudir", wsId],
    enabled: !!wsId,
    queryFn: async () =>
      (await (db as any).from("organizations").select("*").eq("workspace_id", wsId)
        .order("is_primary", { ascending: false }).limit(1).maybeSingle()).data,
  });

  const { data: rows = [], isLoading } = useQuery<KudirRow[]>({
    queryKey: ["kudir", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const [{ data: pays }, { data: invs }] = await Promise.all([
        (db as any).from("invoice_payments")
          .select("id,invoice_id,partner_id,amount,date,direction,method,note")
          .eq("workspace_id", wsId),
        (db as any).from("invoices")
          .select("id,number,kind,doc_type,total,cash_received,issue_date,note,fiscal,status,is_return,partner:partners(name)")
          .eq("workspace_id", wsId),
      ]);

      const byId = new Map<string, any>();
      for (const i of (invs ?? []) as any[]) byId.set(String(i.id), i);
      const out: KudirRow[] = [];

      // 1. Оплаты по накладным — доход или расход по дате денег (кассовый метод).
      for (const p of (pays ?? []) as any[]) {
        const amount = Number(p.amount || 0);
        if (!amount) continue;
        const inv = p.invoice_id ? byId.get(String(p.invoice_id)) : null;
        if (inv?.status === "cancelled") continue;
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
          content: isIncome
            ? `Поступление оплаты от покупателя${inv?.partner?.name ? ` ${inv.partner.name}` : ""}`
            : `Оплата поставщику${inv?.partner?.name ? ` ${inv.partner.name}` : ""}`,
          income: isIncome ? amount : 0,
          expense: isIncome ? 0 : amount,
          hasReceipt: receipt,
          receiptNumber: f?.receiptNumber ?? f?.fiscalDocNumber ?? null,
        });
      }

      // 2. Кассовые ордера ПКО/РКО без привязки к оплате накладной.
      for (const i of (invs ?? []) as any[]) {
        if (i.doc_type !== "cash_receipt" || i.status === "cancelled") continue;
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
        });
      }

      // 3. Продажи с пробитым чеком, по которым оплата отдельно не записана.
      const paidInvoices = new Set((pays ?? []).map((p: any) => String(p.invoice_id ?? "")));
      for (const i of (invs ?? []) as any[]) {
        if (i.doc_type !== "shipment" || i.kind !== "outgoing" || i.status === "cancelled") continue;
        const f = i.fiscal;
        if (!(f?.receiptNumber || f?.fiscalDocNumber)) continue;
        if (paidInvoices.has(String(i.id))) continue;
        const amount = Number(f.total ?? i.total ?? 0);
        if (!amount) continue;
        out.push({
          id: `s-${i.id}`,
          date: String(i.issue_date ?? "").slice(0, 10),
          doc: `${ruDate(String(i.issue_date ?? ""))} № ${i.number ?? ""}`,
          content: i.is_return
            ? "Возврат покупателю по чеку"
            : `Выручка по чеку${i.partner?.name ? ` · ${i.partner.name}` : ""}`,
          income: i.is_return ? 0 : amount,
          expense: i.is_return ? amount : 0,
          hasReceipt: true,
          receiptNumber: f.receiptNumber ?? f.fiscalDocNumber ?? null,
        });
      }

      return out.filter((r) => r.date);
    },
  });

  const selected = useMemo(() => filterKudirByMode(rows, mode), [rows, mode]);
  const book = useMemo(() => buildKudir(selected, year), [selected, year]);
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
    downloadCsv(`кудир-${year}`, flat, [
      { header: "Квартал", value: (r) => r.quarter },
      { header: "№ п/п", value: (r) => r.no },
      { header: "Дата и номер первичного документа", value: (r) => r.doc },
      { header: "Содержание операции", value: (r) => r.content },
      { header: "Доходы", value: (r) => r.income },
      { header: "Расходы", value: (r) => r.expense },
      { header: "Чек", value: (r) => r.receipt },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2">
          <BookText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">КУДиР</h1>
          <p className="text-sm text-muted-foreground">
            Книга учёта доходов и расходов при УСН (приказ ФНС № ЕА-7-3/816@): операции по дате денег, итоги по кварталам.
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportExcel} disabled={!flat.length}>
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
        <Button
          disabled={!flat.length}
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
              { mode, objectIncomeOnly: object === "income" },
            )
          }
        >
          <Printer className="h-4 w-4 mr-1" /> Печать КУДиР
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <Label className="text-xs">Какие документы включать</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as KudirMode)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все документы</SelectItem>
                <SelectItem value="receipts">Только с чеками</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Доходы и расходы попадают в книгу по дате денег: оплаты по накладным, приходные и расходные кассовые ордера,
          а также продажи с пробитым чеком, по которым оплата отдельно не записана.
        </p>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-emerald-600 dark:text-emerald-400">Доходы за год: <b>{fmt.format(book.income)} ₽</b></span>
        {object === "income_minus" && (
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
              <TableHead className="text-right">Расходы</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!flat.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                  {isLoading ? "Загрузка…" : "За выбранный год операций нет"}
                </TableCell>
              </TableRow>
            )}
            {book.quarters.filter((q) => q.rows.length).map((q) => (
              <Fragment key={q.quarter}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={6} className="font-medium">{ROMAN[q.quarter - 1]} квартал {year} года</TableCell>
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
                    <TableCell className="text-right">{r.expense ? fmt.format(r.expense) : ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={4}>Итого за {ROMAN[q.quarter - 1]} квартал · {q.ytdLabel} {fmt.format(q.incomeYtd)} ₽</TableCell>
                  <TableCell className="text-right">{fmt.format(q.income)}</TableCell>
                  <TableCell className="text-right">{fmt.format(q.expense)}</TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
