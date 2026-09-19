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

const COLUMNS: ColumnDef[] = [
  { key: "number", label: "№", width: 130, required: true },
  { key: "issue_date", label: "Дата", width: 110 },
  { key: "doc", label: "Документ", width: 190 },
  { key: "kind", label: "Направление", width: 130 },
  { key: "partner", label: "Контрагент", width: 240 },
  { key: "status", label: "Статус", width: 150 },
  { key: "note", label: "Комментарий", width: 240, hiddenByDefault: true },
  { key: "total", label: "Сумма", width: 140 },
];

function InvoicesPage() {
  const navigate = useNavigate();
  const wsId = useActiveWorkspaceId();
  const brand = usePrintBrand();
  const cols = useTableColumns("crm.journal.columns.v1", COLUMNS);
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
        .select("id,number,doc_type,kind,status,status_id,total,cash_received,issue_date,is_return,note,partner:partners(name),status_ref:invoice_statuses(name,color)")

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

  const cell = (i: any, key: string) => {
    switch (key) {
      case "number":
        return <Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-primary hover:underline">{i.number}</Link>;
      case "issue_date":
        return dfmt.format(new Date(i.issue_date));
      case "doc":
        return <span className="font-medium">{docTitle(i.doc_type, i.kind, i.is_return)}</span>;
      case "kind":
        return i.kind === "incoming" ? (
          <span className="inline-flex items-center gap-1 text-success"><ArrowDownToLine className="h-3.5 w-3.5" /> Приход</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-primary"><ArrowUpFromLine className="h-3.5 w-3.5" /> Расход</span>
        );
      case "partner":
        return i.partner?.name ?? "—";
      case "status":
        return i.status_ref ? (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.status_ref.color }} />
            {i.status_ref.name}
          </span>
        ) : <span className="text-muted-foreground text-sm">{docStatusLabel(i)}</span>;
      case "note":
        return <span className="text-sm text-muted-foreground">{i.note || "—"}</span>;
      case "total":
        return <span className="font-medium">{fmt.format(docAmount(i))}</span>;
      default:
        return null;
    }
  };

  const listColumns = cols.visible.map(c => ({
    header: c.label,
    value: (i: any) => {
      switch (c.key) {
        case "number": return i.number;
        case "issue_date": return csvDate(i.issue_date);
        case "doc": return docTitle(i.doc_type, i.kind, i.is_return);
        case "kind": return i.kind === "incoming" ? "Приход" : "Расход";
        case "partner": return i.partner?.name ?? "";
        case "status": return i.status_ref?.name ?? docStatusLabel(i);
        case "note": return i.note ?? "";
        case "total": return docAmount(i);
        default: return "";
      }
    },
  }));
  const exportCsv = () => downloadCsv("документы", filtered, listColumns);
  const printInvoices = () => printList("Документы", filtered, listColumns, brand);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Документы</h1>
          <p className="text-sm text-muted-foreground">Общий журнал: заявки, накладные, поступления, ПКО и РКО.</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="ml-auto" title="Выбрать колонки журнала">
              <Settings2 className="h-4 w-4 mr-1" /> Настроить
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <p className="text-sm font-medium">Колонки журнала</p>
            <p className="mt-1 text-xs text-muted-foreground">Ширину колонок можно менять, потянув за границу заголовка. Настройки сохраняются.</p>
            <div className="mt-3 space-y-2">
              {COLUMNS.map(c => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cols.isVisible(c.key)}
                    disabled={c.required}
                    onCheckedChange={v => cols.toggle(c.key, v === true)}
                  />
                  <span className={c.required ? "text-muted-foreground" : ""}>{c.label}</span>
                </label>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={cols.reset}>Сбросить</Button>
          </PopoverContent>
        </Popover>
        <Button variant="outline" onClick={exportCsv} disabled={!filtered.length} title="Выгрузить в Excel">
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
        <Table style={{ tableLayout: "fixed", width: "100%", minWidth: cols.visible.reduce((s, c) => s + (cols.widths[c.key] ?? c.width), 0) }}>
          <colgroup>
            {cols.visible.map(c => <col key={c.key} style={{ width: cols.widths[c.key] ?? c.width }} />)}
          </colgroup>
          <TableHeader>
            <TableRow>
              {cols.visible.map(c => (
                <TableHead key={c.key} className={`relative select-none ${c.key === "total" ? "text-right" : ""}`}>
                  <span className="block truncate">{c.label}</span>
                  <span
                    role="separator"
                    aria-label={`Изменить ширину колонки ${c.label}`}
                    onPointerDown={e => cols.startResize(c.key, e)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={cols.visible.length} className="text-center text-muted-foreground py-10">
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
                  {cols.visible.map(c => (
                    <TableCell key={c.key} className={`truncate ${c.key === "total" ? "text-right" : ""}`}>
                      {cell(i, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );

}
