import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/firebase/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/shipments/")({
  head: () => ({ meta: [{ title: "Накладные — КабинетCRM" }] }),
  component: ShipmentsPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

type Tab = "all" | "outgoing" | "incoming";

function ShipmentsPage() {
  const wsId = useActiveWorkspaceId();
  const [tab, setTab] = useState<Tab>("all");

  const { data: rows = [] } = useQuery({
    queryKey: ["shipments", wsId, tab],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (db as any)
        .from("invoices")
        .select("id,number,kind,status,total,issue_date,is_return,partner:partners(name)")
        .eq("doc_type", "shipment")
        .eq("workspace_id", wsId)
        .order("issue_date", { ascending: false });
      if (tab !== "all") q = q.eq("kind", tab);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 p-2">
          <Truck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Накладные</h1>
          <p className="text-sm text-muted-foreground">Реализация товаров (продажа) и поступление товаров (закупка).</p>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {([
          { k: "all", label: "Все" },
          { k: "outgoing", label: "Продажи" },
          { k: "incoming", label: "Закупки" },
        ] as { k: Tab; label: string }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t.k ? "border-amber-500 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden border-t-2 border-t-amber-500/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Учёт</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Накладных пока нет</TableCell></TableRow>
            )}
            {rows.map(i => (
              <TableRow key={i.id} className="hover:bg-muted/40">
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
                </TableCell>
                <TableCell className="text-right font-medium">{fmt.format(Number(i.total))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}