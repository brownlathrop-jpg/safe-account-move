import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Receipt, Truck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Заявки — КабинетCRM" }] }),
  component: InvoicesPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function InvoicesPage() {
  const wsId = useActiveWorkspaceId();
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", "orders", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("id,number,kind,status,status_id,total,issue_date,partner:partners(name),status_ref:invoice_statuses(name,color),children:invoices!parent_id(id,doc_type)")
        .eq("doc_type", "order")
        .eq("workspace_id", wsId)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Заявки</h1>
        <p className="text-sm text-muted-foreground">Заявки покупателей и поставщикам. Накладные и ПКО создаются на их основании.</p>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Документы</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Заявок пока нет</TableCell></TableRow>
            )}
            {invoices.map(i => {
              const ships = (i.children ?? []).filter((c: any) => c.doc_type === "shipment").length;
              const pkos = (i.children ?? []).filter((c: any) => c.doc_type === "cash_receipt").length;
              return (
                <TableRow key={i.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell><Link to="/invoices/$id" params={{ id: i.id }} className="font-medium text-primary hover:underline">{i.number}</Link></TableCell>
                  <TableCell>{dfmt.format(new Date(i.issue_date))}</TableCell>
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
                    ) : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> {ships}</span>
                      <span className="inline-flex items-center gap-1"><Receipt className="h-3.5 w-3.5" /> {pkos}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{fmt.format(Number(i.total))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
