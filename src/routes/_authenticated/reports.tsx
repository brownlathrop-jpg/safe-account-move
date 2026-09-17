import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Отчёты: долги и движение денег — КабинетCRM" },
      { name: "description", content: "Задолженность контрагентов и движение денег по статьям за период в КабинетCRM." },
      { property: "og:title", content: "Отчёты: долги и движение денег — КабинетCRM" },
      { property: "og:description", content: "Задолженность контрагентов и движение денег по статьям за период." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function ReportsPage() {
  const wsId = useActiveWorkspaceId();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-list", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("partners").select("id,name,kind").eq("workspace_id", wsId).order("name")).data ?? [],
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["invoices", wsId, "reports"],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoices")
      .select("id,partner_id,doc_type,kind,issue_date,total,status,is_return,number")
      .eq("workspace_id", wsId)).data ?? [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["invoice_payments", wsId, "reports"],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoice_payments")
      .select("id,invoice_id,partner_id,amount,date,direction,method,cashflow_item_id").eq("workspace_id", wsId)).data ?? [],
  });

  const { data: cashflowItems = [] } = useQuery({
    queryKey: ["cashflow_items", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("cashflow_items").select("id,name").eq("workspace_id", wsId).order("name")).data ?? [],
  });

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments as any[]) {
      const k = String(p.invoice_id ?? "");
      m.set(k, (m.get(k) ?? 0) + Number(p.amount || 0));
    }
    return m;
  }, [payments]);

  // ------------------------------------------------------- задолженность
  const debts = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; owedToUs: number; weOwe: number }>();
    for (const d of docs as any[]) {
      if (d.doc_type !== "shipment" || d.status !== "posted" || !d.partner_id) continue;
      const p = (partners as any[]).find(x => x.id === d.partner_id);
      const cur = rows.get(d.partner_id) ?? { id: d.partner_id, name: p?.name ?? "Без контрагента", owedToUs: 0, weOwe: 0 };
      const sign = d.is_return ? -1 : 1;
      const left = sign * (Number(d.total || 0) - (paidByInvoice.get(d.id) ?? 0));
      if (d.kind === "outgoing") cur.owedToUs += left; else cur.weOwe += left;
      rows.set(d.partner_id, cur);
    }
    return [...rows.values()]
      .filter(r => Math.abs(r.owedToUs) > 0.005 || Math.abs(r.weOwe) > 0.005)
      .sort((a, b) => (b.owedToUs - b.weOwe) - (a.owedToUs - a.weOwe));
  }, [docs, partners, paidByInvoice]);

  const debtTotals = useMemo(
    () => debts.reduce((s, r) => ({ owedToUs: s.owedToUs + r.owedToUs, weOwe: s.weOwe + r.weOwe }), { owedToUs: 0, weOwe: 0 }),
    [debts],
  );

  // ------------------------------------------------------- движение денег
  const inPeriod = useMemo(
    () => (payments as any[]).filter(p => {
      const d = String(p.date ?? "").slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    }),
    [payments, from, to],
  );

  const cashflow = useMemo(() => {
    const rows = new Map<string, { name: string; income: number; expense: number }>();
    for (const p of inPeriod) {
      const key = String(p.cashflow_item_id ?? "none");
      const name = (cashflowItems as any[]).find(c => c.id === p.cashflow_item_id)?.name ?? "Без статьи";
      const cur = rows.get(key) ?? { name, income: 0, expense: 0 };
      if (p.direction === "out") cur.expense += Number(p.amount || 0);
      else cur.income += Number(p.amount || 0);
      rows.set(key, cur);
    }
    return [...rows.values()].sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
  }, [inPeriod, cashflowItems]);

  const cashTotals = useMemo(
    () => cashflow.reduce((s, r) => ({ income: s.income + r.income, expense: s.expense + r.expense }), { income: 0, expense: 0 }),
    [cashflow],
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Отчёты</h1>

      <Tabs defaultValue="debts">
        <TabsList>
          <TabsTrigger value="debts">Задолженность</TabsTrigger>
          <TabsTrigger value="cash">Движение денег</TabsTrigger>
        </TabsList>

        <TabsContent value="debts" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Нам должны</div>
              <div className="text-xl font-semibold">{fmt.format(debtTotals.owedToUs)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Мы должны</div>
              <div className="text-xl font-semibold">{fmt.format(debtTotals.weOwe)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Сальдо</div>
              <div className={`text-xl font-semibold ${debtTotals.owedToUs - debtTotals.weOwe >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {fmt.format(debtTotals.owedToUs - debtTotals.weOwe)}
              </div>
            </Card>
          </div>
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Контрагент</TableHead>
                  <TableHead className="text-right">Нам должны</TableHead>
                  <TableHead className="text-right">Мы должны</TableHead>
                  <TableHead className="text-right">Сальдо</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debts.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10">Долгов нет</TableCell></TableRow>
                )}
                {debts.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to="/partner/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.name}</Link>
                    </TableCell>
                    <TableCell className="text-right">{fmt.format(r.owedToUs)}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.weOwe)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.owedToUs - r.weOwe >= 0 ? "" : "text-destructive"}`}>
                      {fmt.format(r.owedToUs - r.weOwe)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="cash" className="space-y-4">
          <Card className="p-4 flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">С даты</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">По дату</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="ml-auto text-sm">
              Приход: <b className="text-emerald-600">{fmt.format(cashTotals.income)}</b>{" · "}
              Расход: <b className="text-destructive">{fmt.format(cashTotals.expense)}</b>{" · "}
              Итого: <b>{fmt.format(cashTotals.income - cashTotals.expense)}</b>
            </div>
          </Card>
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Статья</TableHead>
                  <TableHead className="text-right">Приход</TableHead>
                  <TableHead className="text-right">Расход</TableHead>
                  <TableHead className="text-right">Итого</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashflow.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-10">За период оплат нет</TableCell></TableRow>
                )}
                {cashflow.map(r => (
                  <TableRow key={r.name}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmt.format(r.income)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmt.format(r.expense)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt.format(r.income - r.expense)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
