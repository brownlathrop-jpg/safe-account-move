// Кассовая книга (форма КО-4): записи по кассовым ордерам и продажам,
// оплаченным наличными, с итогами за день и остатком кассы.
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Download, Printer, Receipt } from "lucide-react";
import { downloadCsv } from "@/lib/export-csv";
import { useOrganizations, useMyOrgId, pickOrg } from "@/lib/organizations";
import {
  buildCashBook, filterByMode, openingBalance, printCashBook,
  type CashBookDoc, type CashBookMode,
} from "@/lib/cash-book";
import { useViewLog } from "@/hooks/use-view-log";
import { useFeature } from "@/hooks/use-billing";
import { FeatureLock } from "@/components/FeatureLock";

export const Route = createFileRoute("/_authenticated/reports/book")({
  head: () => ({
    meta: [
      { title: "Кассовая книга КО-4 — КабинетCRM" },
      { name: "description", content: "Кассовая книга по форме КО-4: приход и расход наличных, итоги за день и остаток кассы." },
      { property: "og:title", content: "Кассовая книга КО-4 — КабинетCRM" },
      { property: "og:description", content: "Кассовая книга по форме КО-4 с печатью листов за каждый день." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CashBookPageGate,
});

const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ruDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CashBookPage() {
  useViewLog("cashbook");
  const wsId = useActiveWorkspaceId();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<CashBookMode>("all");
  const [cashier, setCashier] = useState("");

  // Кассовая книга формируется по выбранному юрлицу
  const { data: orgs = [] } = useOrganizations(wsId);
  const { data: myOrgId } = useMyOrgId(wsId);
  const [orgSel, setOrgSel] = useState<string>("");
  const org = pickOrg(orgs, orgSel || myOrgId || null) as any;
  const effOrgId: string | null = org?.id ?? null;

  // Кассовые ордера (ПКО/РКО) и продажи, оплаченные наличными по чеку.
  const { data: docs = [], isLoading } = useQuery<CashBookDoc[]>({
    queryKey: ["cash-book", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data: cash, error: e1 } = await (db as any)
        .from("invoices")
        .select("id,number,kind,total,cash_received,issue_date,note,fiscal,status,organization_id,partner:partners(name)")
        .eq("doc_type", "cash_receipt")
        .eq("workspace_id", wsId);
      if (e1) throw e1;
      const { data: sales, error: e2 } = await (db as any)
        .from("invoices")
        .select("id,number,kind,total,issue_date,note,fiscal,status,is_return,organization_id,partner:partners(name)")
        .eq("doc_type", "shipment")
        .eq("kind", "outgoing")
        .eq("workspace_id", wsId);
      if (e2) throw e2;

      const list: CashBookDoc[] = [];
      for (const i of (cash ?? []) as any[]) {
        if (i.status === "cancelled") continue;
        const amount = Number(i.cash_received ?? i.total ?? 0);
        if (!amount) continue;
        list.push({
          id: i.id,
          number: String(i.number ?? ""),
          date: String(i.issue_date ?? "").slice(0, 10),
          direction: i.kind === "incoming" ? "in" : "out",
          amount,
          party: i.partner?.name ?? "",
          note: i.note ?? "",
          hasReceipt: !!(i.fiscal?.receiptNumber || i.fiscal?.fiscalDocNumber),
          receiptNumber: i.fiscal?.receiptNumber ?? i.fiscal?.fiscalDocNumber ?? null,
          orgId: i.organization_id ?? null,
        });
      }
      // Продажи попадают в кассовую книгу, только если оплата наличными:
      // безналичная оплата проходит по расчётному счёту.
      for (const i of (sales ?? []) as any[]) {
        if (i.status !== "posted") continue;
        const f = i.fiscal;
        const isCash = !!f && (f.paymentType ?? "cash") === "cash";
        if (!isCash) continue;
        const amount = Number(f.total ?? i.total ?? 0);
        if (!amount) continue;
        list.push({
          id: i.id,
          number: String(i.number ?? ""),
          date: String(i.issue_date ?? "").slice(0, 10),
          direction: i.is_return ? "out" : "in",
          amount,
          party: i.partner?.name ?? "Розничный покупатель",
          note: i.is_return ? "Возврат по чеку" : "Продажа по чеку",
          hasReceipt: true,
          receiptNumber: f.receiptNumber ?? f.fiscalDocNumber ?? null,
          orgId: i.organization_id ?? null,
        });
      }
      return list;
    },
  });

  const selected = useMemo(
    () => filterByMode(effOrgId ? docs.filter((d) => (d.orgId ?? null) === effOrgId) : docs, mode),
    [docs, mode, effOrgId],
  );
  const book = useMemo(
    () => buildCashBook(selected, { from, to, opening: openingBalance(selected, from) }),
    [selected, from, to],
  );

  const flat = useMemo(
    () =>
      book.days.flatMap((d) =>
        d.rows.map((r) => ({
          date: ruDate(d.date),
          sheet: d.sheet,
          number: r.number,
          party: r.party,
          note: r.note,
          income: r.direction === "in" ? r.amount : 0,
          expense: r.direction === "out" ? r.amount : 0,
          receipt: r.hasReceipt ? `№ ${r.receiptNumber ?? ""}`.trim() : "нет",
          closing: d.closing,
        })),
      ),
    [book],
  );

  const exportExcel = () =>
    downloadCsv("кассовая-книга", flat, [
      { header: "Дата", value: (r) => r.date },
      { header: "Лист", value: (r) => r.sheet },
      { header: "Номер документа", value: (r) => r.number },
      { header: "От кого получено / кому выдано", value: (r) => r.party },
      { header: "Основание", value: (r) => r.note },
      { header: "Приход", value: (r) => r.income },
      { header: "Расход", value: (r) => r.expense },
      { header: "Чек", value: (r) => r.receipt },
      { header: "Остаток на конец дня", value: (r) => r.closing },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Кассовая книга</h1>
          <p className="text-sm text-muted-foreground">
            Форма КО-4 (ОКУД 0310004) по Указанию Банка России № 3210-У: лист на каждый день, итоги за день и остаток кассы.
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportExcel} disabled={!flat.length}>
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
        <Button
          onClick={() =>
            printCashBook(
              book,
              {
                name: org?.name ?? "",
                okpo: org?.okpo ?? "",
                director_name: org?.director_name ?? "",
                accountant_name: org?.accountant_name ?? "",
              },
              { cashier, mode, from, to },
            )
          }
          disabled={!book.days.length}
        >
          <Printer className="h-4 w-4 mr-1" /> Печать КО-4
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
            <Label className="text-xs">Период с</Label>
            <Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">по</Label>
            <Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Какие документы включать</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as CashBookMode)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все документы</SelectItem>
                <SelectItem value="receipts">Только с чеками</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Кассир (в подписи листа)</Label>
            <Input className="h-9" placeholder="Фамилия И. О." value={cashier} onChange={(e) => setCashier(e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          В книгу попадают приходные и расходные кассовые ордера, а также продажи, оплаченные наличными с пробитым чеком.
          Оплаты картой проходят по расчётному счёту и в кассовую книгу не включаются.
        </p>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm">
        <span>Остаток на начало: <b>{fmt.format(book.opening)} ₽</b></span>
        <span className="text-emerald-600 dark:text-emerald-400">Приход: <b>{fmt.format(book.income)} ₽</b></span>
        <span className="text-destructive">Расход: <b>{fmt.format(book.expense)} ₽</b></span>
        <span>Остаток на конец: <b>{fmt.format(book.closing)} ₽</b></span>
      </div>

      <Card className="p-0 overflow-x-auto border-t-2 border-t-emerald-500/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер документа</TableHead>
              <TableHead>От кого получено / кому выдано</TableHead>
              <TableHead>Чек</TableHead>
              <TableHead className="text-right">Приход</TableHead>
              <TableHead className="text-right">Расход</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!book.days.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  {isLoading ? "Загрузка…" : "За выбранный период кассовых операций нет"}
                </TableCell>
              </TableRow>
            )}
            {book.days.map((day) => (
              <Fragment key={day.date}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={3} className="font-medium">
                    Касса за {ruDate(day.date)} · лист {day.sheet}
                  </TableCell>
                  <TableCell colSpan={2} className="text-right text-sm text-muted-foreground">
                    Остаток на начало дня {fmt.format(day.opening)} ₽
                  </TableCell>
                </TableRow>
                {day.rows.map((r) => (
                  <TableRow key={`${day.date}-${r.id}-${r.number}`}>
                    <TableCell className="font-medium">{r.number}</TableCell>
                    <TableCell>
                      {r.party || "—"}
                      {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
                    </TableCell>
                    <TableCell>
                      {r.hasReceipt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <Receipt className="h-3.5 w-3.5" /> № {r.receiptNumber ?? "—"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">без чека</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.direction === "in" ? fmt.format(r.amount) : ""}</TableCell>
                    <TableCell className="text-right">{r.direction === "out" ? fmt.format(r.amount) : ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={3}>
                    Итого за день · остаток на конец дня {fmt.format(day.closing)} ₽
                  </TableCell>
                  <TableCell className="text-right">{fmt.format(day.income)}</TableCell>
                  <TableCell className="text-right">{fmt.format(day.expense)}</TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/** Раздел доступен не на всех тарифах. */
function CashBookPageGate() {
  const gate = useFeature("cashbook");
  if (gate.loading) return <div className="p-4 text-sm text-muted-foreground">Загрузка…</div>;
  if (!gate.allowed) return <FeatureLock feature="cashbook" planLabel={gate.planLabel} />;
  return <CashBookPage />;
}
