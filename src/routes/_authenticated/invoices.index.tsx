import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Search, Download, Printer, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadCsv, csvDate } from "@/lib/export-csv";
import { printList } from "@/lib/print-list";
import { usePrintBrand } from "@/hooks/use-print-brand";
import { useTableColumns, type ColumnDef } from "@/hooks/use-table-columns";
import { docAmount, docStatusLabel, docTitle } from "@/lib/doc-tree";


export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({
    meta: [
      { title: "Документы — КабинетCRM" },
      { name: "description", content: "Общий журнал заявок, накладных, поступлений и кассовых ордеров." },
      { property: "og:title", content: "Документы — КабинетCRM" },
      { property: "og:description", content: "Общий журнал заявок, накладных, поступлений и кассовых ордеров." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoicesPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function InvoicesPage() {
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();
  const brand = usePrintBrand();
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState<"all" | "order" | "shipment" | "cash_receipt">("all");
  const [kind, setKind] = useState<"all" | "incoming" | "outgoing">("all");
  const [statusName, setStatusName] = useState("all");
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", "journal", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("invoices")
        .select("id,number,doc_type,kind,status,status_id,total,cash_received,issue_date,is_return,partner:partners(name),status_ref:invoice_statuses(name,color)")
        .eq("workspace_id", wsId)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const statuses = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of invoices as any[]) if (i.status_ref?.name) m.set(i.status_ref.name, i.status_ref.name);
    return [...m.keys()].sort();
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (invoices as any[]).filter(i => {
      if (kind !== "all" && i.kind !== kind) return false;
      if (docType !== "all" && i.doc_type !== docType) return false;
      if (statusName !== "all" && (i.status_ref?.name ?? "") !== statusName) return false;
      if (!q) return true;
      return String(i.number ?? "").toLowerCase().includes(q)
        || String(i.partner?.name ?? "").toLowerCase().includes(q);
    });
  }, [invoices, search, docType, kind, statusName]);

  const total = useMemo(() => filtered.reduce((s, i) => s + docAmount(i), 0), [filtered]);

  const listColumns = [
    { header: "№", value: (i: any) => i.number },
    { header: "Дата", value: (i: any) => csvDate(i.issue_date) },
    { header: "Документ", value: (i: any) => docTitle(i.doc_type, i.kind, i.is_return) },
    { header: "Направление", value: (i: any) => (i.kind === "incoming" ? "Приход" : "Расход") },
    { header: "Контрагент", value: (i: any) => i.partner?.name ?? "" },
    { header: "Статус", value: (i: any) => i.status_ref?.name ?? "" },
    { header: "Сумма", value: (i: any) => docAmount(i) },
  ];
  const exportCsv = () => downloadCsv("документы", filtered, listColumns);
  const printInvoices = () => printList("Документы", filtered, listColumns, brand);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Документы</h1>
          <p className="text-sm text-muted-foreground">Общий журнал: заявки, накладные, поступления, ПКО и РКО.</p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!filtered.length} title="Выгрузить в Excel">
          <Download className="h-4 w-4 mr-1" /> Excel
        </Button>
        <Button variant="outline" onClick={printInvoices} disabled={!filtered.length} title="Печать списка / сохранить в PDF">
          <Printer className="h-4 w-4 mr-1" /> Печать
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Номер или контрагент" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={docType} onValueChange={v => setDocType(v as typeof docType)}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все документы</SelectItem>
            <SelectItem value="order">Заявки</SelectItem>
            <SelectItem value="shipment">Накладные и поступления</SelectItem>
            <SelectItem value="cash_receipt">ПКО и РКО</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={v => setKind(v as any)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="outgoing">Расход</SelectItem>
            <SelectItem value="incoming">Приход</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusName} onValueChange={setStatusName}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой статус</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} документов на {fmt.format(total)}</span>
      </div>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Документ</TableHead>
              <TableHead>Направление</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                {invoices.length ? "Ничего не найдено" : "Документов пока нет"}
              </TableCell></TableRow>
            )}
            {filtered.map(i => (
                <TableRow
                  key={i.id}
                  className="cursor-pointer hover:bg-muted/40"
                  title={`Открыть: ${docTitle(i.doc_type, i.kind, i.is_return)}`}
                  onClick={() => navigate({ to: "/invoices/$id", params: { id: i.id } })}
                >
                  <TableCell><Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-primary hover:underline">{i.number}</Link></TableCell>
                  <TableCell>{dfmt.format(new Date(i.issue_date))}</TableCell>
                  <TableCell className="font-medium">{docTitle(i.doc_type, i.kind, i.is_return)}</TableCell>
                  <TableCell>
                    {i.kind === "incoming" ? (
                      <span className="inline-flex items-center gap-1 text-success"><ArrowDownToLine className="h-3.5 w-3.5" /> Приход</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-primary"><ArrowUpFromLine className="h-3.5 w-3.5" /> Расход</span>
                    )}
                  </TableCell>
                  <TableCell>{i.partner?.name ?? "—"}</TableCell>
                  <TableCell>
                    {i.status_ref ? (
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.status_ref.color }} />
                        {i.status_ref.name}
                      </span>
                    ) : <span className="text-muted-foreground text-sm">{docStatusLabel(i)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium">{fmt.format(docAmount(i))}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
