import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Truck, Search, Download, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { downloadCsv, csvDate } from "@/lib/export-csv";
import { printList } from "@/lib/print-list";

export const Route = createFileRoute("/_authenticated/shipments/")({
  head: () => ({ meta: [{ title: "Накладные — КабинетCRM" }] }),
  component: ShipmentsPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

type Tab = "all" | "outgoing" | "incoming";

function ShipmentsPage() {
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "posted" | "draft" | "cancelled">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["shipments", wsId, tab],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (db as any)
        .from("invoices")
        .select("id,number,kind,status,total,issue_date,is_return,fiscal,partner:partners(name)")
        .eq("doc_type", "shipment")
        .eq("workspace_id", wsId)
        .order("issue_date", { ascending: false });
      if (tab !== "all") q = q.eq("kind", tab);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["invoice_payments", wsId, "shipments"],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoice_payments").select("invoice_id,amount").eq("workspace_id", wsId)).data ?? [],
  });

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments as any[]) {
      const k = String(p.invoice_id ?? "");
      m.set(k, (m.get(k) ?? 0) + Number(p.amount || 0));
    }
    return m;
  }, [payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows as any[]).filter(i => {
      if (status !== "all" && i.status !== status) return false;
      const d = String(i.issue_date ?? "").slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (!q) return true;
      return String(i.number ?? "").toLowerCase().includes(q)
        || String(i.partner?.name ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, status, from, to]);

  const total = useMemo(() => filtered.reduce((s, i) => s + Number(i.total || 0), 0), [filtered]);

  const listColumns = [
    { header: "№", value: (i: any) => i.number },
    { header: "Дата", value: (i: any) => csvDate(i.issue_date) },
    { header: "Тип", value: (i: any) => (i.kind === "incoming" ? "Закупка" : "Продажа") + (i.is_return ? " (возврат)" : "") },
    { header: "Контрагент", value: (i: any) => i.partner?.name ?? "" },
    { header: "Учёт", value: (i: any) => (i.status === "posted" ? "Проведена" : i.status === "cancelled" ? "Отменена" : "Черновик") },
    { header: "Сумма", value: (i: any) => Number(i.total || 0) },
    { header: "Оплачено", value: (i: any) => paidByInvoice.get(i.id) ?? 0 },
    { header: "Осталось", value: (i: any) => Number(i.total || 0) - (paidByInvoice.get(i.id) ?? 0) },
  ];
  const exportCsv = () => downloadCsv("накладные", filtered, listColumns);
  const printShipments = () => printList("Накладные", filtered, listColumns);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 p-2">
          <Truck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Накладные</h1>
          <p className="text-sm text-muted-foreground">Реализация товаров (продажа) и поступление товаров (закупка).</p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!filtered.length} title="Выгрузить в Excel">
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
        <Button variant="outline" onClick={printShipments} disabled={!filtered.length} title="Печать списка / сохранить в PDF">
          <Printer className="h-4 w-4 mr-1" /> Печать
        </Button>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          { k: "all", label: "Все" },
          { k: "outgoing", label: "Продажи" },
          { k: "incoming", label: "Закупки" },
        ] as { k: Tab; label: string }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.k ? "border-amber-500 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Номер или контрагент" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой учёт</SelectItem>
            <SelectItem value="posted">Проведена</SelectItem>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="cancelled">Отменена</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-[150px]" value={from} onChange={e => setFrom(e.target.value)} title="Дата с" />
        <Input type="date" className="w-[150px]" value={to} onChange={e => setTo(e.target.value)} title="Дата по" />
        <span className="text-sm text-muted-foreground">
          {filtered.length} документов на {fmt.format(total)}
        </span>
      </div>

      <Card className="p-0 overflow-x-auto border-t-2 border-t-amber-500/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Учёт</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead className="text-right">Оплата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                {rows.length ? "Ничего не найдено" : "Накладных пока нет"}
              </TableCell></TableRow>
            )}
            {filtered.map(i => (
              <TableRow
                key={i.id}
                className="cursor-pointer hover:bg-muted/40"
                title="Открыть накладную"
                onClick={() => navigate({ to: "/invoices/$id", params: { id: i.id } })}
              >
                <TableCell>
                  <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-primary hover:underline">{i.number}</Link>
                </TableCell>
                <TableCell>{dfmt.format(new Date(i.issue_date))}</TableCell>
                <TableCell>
                  {i.kind === "incoming" ? (
                    <span className="inline-flex items-center gap-1 text-success"><ArrowDownToLine className="h-3.5 w-3.5" /> Закупка</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-primary"><ArrowUpFromLine className="h-3.5 w-3.5" /> Продажа</span>
                  )}
                  {i.is_return && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">Возврат</span>
                  )}
                </TableCell>
                <TableCell>{i.partner?.name ?? "—"}</TableCell>
                <TableCell>
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    i.status === "posted" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : i.status === "cancelled" ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {i.status === "posted" ? "Проведена" : i.status === "cancelled" ? "Отменена" : "Черновик"}
                  </span>
                  {i.fiscal?.receiptNumber || i.fiscal?.fiscalDocNumber ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Чек № {i.fiscal.receiptNumber ?? i.fiscal.fiscalDocNumber}
                    </span>
                  ) : i.kind === "outgoing" && i.status !== "cancelled" && !i.is_return ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Без чека
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-medium">{fmt.format(Number(i.total))}</TableCell>
                <TableCell className="text-right text-sm">
                  {(() => {
                    const paid = paidByInvoice.get(i.id) ?? 0;
                    const left = Number(i.total || 0) - paid;
                    if (paid <= 0) return <span className="text-destructive">не оплачено</span>;
                    if (left > 0.005) return <span className="text-amber-600">осталось {fmt.format(left)}</span>;
                    return <span className="text-emerald-600">оплачено</span>;
                  })()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}