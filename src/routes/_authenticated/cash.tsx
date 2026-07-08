import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cash")({
  head: () => ({ meta: [{ title: "Касса и банк — КабинетCRM" }] }),
  component: CashPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

type Tab = "all" | "incoming" | "outgoing";

function CashPage() {
  const wsId = useActiveWorkspaceId();
  const [tab, setTab] = useState<Tab>("all");

  const { data: rows = [] } = useQuery({
    queryKey: ["cash", wsId, tab],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("invoices")
        .select("id,number,kind,total,issue_date,partner:partners(name),note")
        .eq("doc_type", "cash_receipt")
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
        <div className="rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 p-2">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Касса и банк</h1>
          <p className="text-sm text-muted-foreground">ПКО/РКО и движения по расчётному счёту.</p>
        </div>
      </div>

      <div className="flex gap-1 border-b">
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

      <Card className="p-0 overflow-hidden border-t-2 border-t-emerald-500/60">
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
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Кассовых документов пока нет</TableCell></TableRow>
            )}
            {rows.map(i => (
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
                <TableCell className="text-right font-medium">{fmt.format(Number(i.total))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}