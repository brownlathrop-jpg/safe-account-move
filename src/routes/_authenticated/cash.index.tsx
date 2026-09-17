import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Wallet, Search, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadCsv, csvDate } from "@/lib/export-csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cash/")({
  head: () => ({ meta: [{ title: "Касса и банк — КабинетCRM" }] }),
  component: CashPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

type Tab = "all" | "incoming" | "outgoing";

function CashPage() {
  const wsId = useActiveWorkspaceId();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["cash", wsId, tab],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (db as any)
        .from("invoices")
        .select("id,number,kind,total,cash_received,issue_date,partner:partners(name),note")
        .eq("doc_type", "cash_receipt")
        .eq("workspace_id", wsId)
        .order("issue_date", { ascending: false });
      if (tab !== "all") q = q.eq("kind", tab);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows as any[]).filter(i => {
      const d = String(i.issue_date ?? "").slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (!q) return true;
      return String(i.number ?? "").toLowerCase().includes(q)
        || String(i.partner?.name ?? "").toLowerCase().includes(q)
        || String(i.note ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, from, to]);

  const income = useMemo(() => filtered.filter(i => i.kind === "incoming").reduce((s, i) => s + Number(i.cash_received ?? i.total ?? 0), 0), [filtered]);
  const outcome = useMemo(() => filtered.filter(i => i.kind !== "incoming").reduce((s, i) => s + Number(i.cash_received ?? i.total ?? 0), 0), [filtered]);

  const exportCsv = () => downloadCsv("касса", filtered, [
    { header: "№", value: i => i.number },
    { header: "Дата", value: i => csvDate(i.issue_date) },
    { header: "Тип", value: i => (i.kind === "incoming" ? "Приход" : "Расход") },
    { header: "Контрагент", value: i => i.partner?.name ?? "" },
    { header: "Сумма", value: i => Number(i.cash_received ?? i.total ?? 0) },
    { header: "Основание", value: i => i.note ?? "" },
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Касса и банк</h1>
          <p className="text-sm text-muted-foreground">ПКО/РКО и движения по расчётному счёту.</p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!filtered.length}>
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          { k: "all", label: "Все" },
          { k: "incoming", label: "Приход" },
          { k: "outgoing", label: "Расход" },
        ] as { k: Tab; label: string }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t.k ? "border-emerald-500 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Номер, контрагент или основание" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Input type="date" className="w-[150px]" value={from} onChange={e => setFrom(e.target.value)} title="Дата с" />
        <Input type="date" className="w-[150px]" value={to} onChange={e => setTo(e.target.value)} title="Дата по" />
        <span className="text-sm text-muted-foreground">
          Приход {fmt.format(income)} · Расход {fmt.format(outcome)}
        </span>
      </div>

      <Card className="p-0 overflow-x-auto border-t-2 border-t-emerald-500/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                {rows.length ? "Ничего не найдено" : "Кассовых документов пока нет"}
              </TableCell></TableRow>
            )}
            {filtered.map(i => (
              <TableRow key={i.id} className="hover:bg-muted/40">
                <TableCell>
                  <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-primary hover:underline">{i.number}</Link>
                </TableCell>
                <TableCell>{dfmt.format(new Date(i.issue_date))}</TableCell>
                <TableCell>
                  {i.kind === "incoming" ? (
                    <span className="inline-flex items-center gap-1 text-success"><ArrowDownToLine className="h-3.5 w-3.5" /> Приход</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive"><ArrowUpFromLine className="h-3.5 w-3.5" /> Расход</span>
                  )}
                </TableCell>
                <TableCell>{i.partner?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmt.format(Number(i.cash_received ?? i.total ?? 0))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}