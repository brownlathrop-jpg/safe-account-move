import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { db } from "@/integrations/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/partner/$id")({
  head: () => ({ meta: [{ title: "Карточка контрагента — КабинетCRM" }] }),
  component: PartnerCard,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

type Doc = {
  id: string;
  number: string | null;
  doc_type: string;
  kind: string;
  issue_date: string;
  total: number | null;
  status: string | null;
  is_return: boolean | null;
};

function PartnerCard() {
  const { id } = Route.useParams();

  const { data: partner } = useQuery({
    queryKey: ["partner", id],
    queryFn: async () => {
      const { data, error } = await db.from("partners").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["partner-docs", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("invoices")
        .select("id,number,doc_type,kind,issue_date,total,status,is_return")
        .eq("partner_id", id)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Doc[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["partner-balance", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("invoice_payments")
        .select("id,invoice_id,amount,date,direction,method,note")
        .eq("partner_id", id)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as any[];
    },
  });

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      const key = String(p.invoice_id ?? "");
      m.set(key, (m.get(key) ?? 0) + Number(p.amount || 0));
    }
    return m;
  }, [payments]);

  // Долг считаем по проведённым накладным: сумма документа минус оплаты.
  const balance = useMemo(() => {
    let owedToUs = 0;
    let weOwe = 0;
    for (const d of docs) {
      if (d.doc_type !== "shipment" || d.status !== "posted") continue;
      const sign = d.is_return ? -1 : 1;
      const left = sign * (Number(d.total || 0) - (paidByInvoice.get(d.id) ?? 0));
      if (d.kind === "outgoing") owedToUs += left;
      else weOwe += left;
    }
    return { owedToUs, weOwe, net: owedToUs - weOwe };
  }, [docs, paidByInvoice]);

  if (!partner) return <div className="text-muted-foreground">Загрузка…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><Link to="/partners"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl font-semibold">{partner.name}</h1>
          <p className="text-sm text-muted-foreground">
            {partner.kind === "supplier" ? "Поставщик" : "Клиент"}
            {partner.inn ? ` · ИНН ${partner.inn}` : ""}
            {partner.phone ? ` · ${partner.phone}` : ""}
          </p>
        </div>
        <Button asChild variant="outline" className="ml-auto">
          <Link to="/reports/reconciliation" search={{ partner: id }}>
            <Scale className="h-4 w-4 mr-1" /> Акт сверки
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Нам должны</div>
          <div className="text-xl font-semibold">{fmt.format(balance.owedToUs)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Мы должны</div>
          <div className="text-xl font-semibold">{fmt.format(balance.weOwe)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Сальдо</div>
          <div className={`text-xl font-semibold ${balance.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>
            {fmt.format(balance.net)}
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b font-medium">История документов</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Документ</TableHead>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead className="text-right">Оплачено</TableHead>
              <TableHead className="text-right">Осталось</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Документов нет</TableCell></TableRow>
            )}
            {docs.map(d => {
              const paid = paidByInvoice.get(d.id) ?? 0;
              const left = Math.max(0, Number(d.total || 0) - paid);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.doc_type === "shipment" ? "Накладная" : d.doc_type === "order" ? "Заявка" : "Касса"}
                    {d.is_return && <Badge variant="outline" className="ml-2 border-orange-500 text-orange-600">Возврат</Badge>}
                  </TableCell>
                  <TableCell>
                    <Link to="/invoices/$id" params={{ id: d.id }} className="text-primary hover:underline">{d.number || "—"}</Link>
                  </TableCell>
                  <TableCell>{d.issue_date ? dfmt.format(new Date(d.issue_date)) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {d.status === "posted" ? "Проведён" : d.status === "cancelled" ? "Отменён" : "Черновик"}
                  </TableCell>
                  <TableCell className="text-right">{fmt.format(Number(d.total || 0))}</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmt.format(paid)}</TableCell>
                  <TableCell className={`text-right ${left > 0 ? "text-destructive" : ""}`}>{fmt.format(left)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b font-medium">Оплаты</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Документ</TableHead>
              <TableHead>Способ</TableHead>
              <TableHead>Примечание</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Оплат нет</TableCell></TableRow>
            )}
            {payments.map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.date ? dfmt.format(new Date(p.date)) : "—"}</TableCell>
                <TableCell>
                  {p.invoice_id
                    ? <Link to="/invoices/$id" params={{ id: p.invoice_id }} className="text-primary hover:underline">открыть</Link>
                    : "—"}
                </TableCell>
                <TableCell>{p.method === "bank" ? "Банк" : "Наличные"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.note || "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmt.format(Number(p.amount || 0))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
