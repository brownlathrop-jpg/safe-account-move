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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/export-csv";
import { fetchBalances } from "@/lib/stock";

export const Route = createFileRoute("/_authenticated/reports/")({
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
  // Фильтр по юрлицу: продажи/прибыль/долги/деньги — раздельно, склад общий
  const { data: orgs = [] } = useOrganizations(wsId);
  const [orgSel, setOrgSel] = useState<string>("all");
  const effOrgId = orgSel === "all" ? null : orgSel;

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-list", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("partners").select("id,name,kind").eq("workspace_id", wsId).order("name")).data ?? [],
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["invoices", wsId, "reports"],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoices")
      .select("id,partner_id,doc_type,kind,issue_date,total,status,is_return,number,organization_id")
      .eq("workspace_id", wsId)).data ?? [],
  });

  // Документы выбранного юрлица и карта «документ → юрлицо» для оплат и позиций
  const docOrg = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of docs as any[]) m.set(String(d.id), d.organization_id ?? null);
    return m;
  }, [docs]);
  const docsF = useMemo(
    () => (effOrgId ? (docs as any[]).filter((d) => (d.organization_id ?? null) === effOrgId) : (docs as any[])),
    [docs, effOrgId],
  );

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

  // Оплаты выбранного юрлица (по привязке к документу; без документа — только при «все юрлица»)
  const paymentsF = useMemo(
    () => (effOrgId
      ? (payments as any[]).filter((p) => p.invoice_id && docOrg.get(String(p.invoice_id)) === effOrgId)
      : (payments as any[])),
    [payments, docOrg, effOrgId],
  );

  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of paymentsF) {
      const k = String(p.invoice_id ?? "");
      m.set(k, (m.get(k) ?? 0) + Number(p.amount || 0));
    }
    return m;
  }, [paymentsF]);

  // ------------------------------------------------------- задолженность
  const debts = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; owedToUs: number; weOwe: number }>();
    for (const d of docsF) {
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
  }, [docsF, partners, paidByInvoice]);

  const debtTotals = useMemo(
    () => debts.reduce((s, r) => ({ owedToUs: s.owedToUs + r.owedToUs, weOwe: s.weOwe + r.weOwe }), { owedToUs: 0, weOwe: 0 }),
    [debts],
  );

  // ------------------------------------------------------- движение денег
  const inPeriod = useMemo(
    () => paymentsF.filter(p => {
      const d = String(p.date ?? "").slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    }),
    [paymentsF, from, to],
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

  // ------------------------------------------------------- продажи, прибыль, ABC
  const { data: products = [] } = useQuery({
    queryKey: ["products-report", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("products")
      .select("id,name,unit,cost,kind").eq("workspace_id", wsId)).data ?? [],
  });

  const { data: items = [] } = useQuery({
    queryKey: ["invoice_items", wsId, "reports"],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("invoice_items")
      .select("id,invoice_id,product_id,name,quantity,price,sum").eq("workspace_id", wsId)).data ?? [],
  });

  const { data: balances = [] } = useQuery({
    queryKey: ["balances-report", wsId],
    enabled: !!wsId,
    queryFn: () => fetchBalances(wsId!),
  });

  const productById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of products as any[]) m.set(p.id, p);
    return m;
  }, [products]);

  /** Проведённые продажи за период: документ → знак (возврат уменьшает). */
  const salesDocs = useMemo(() => {
    const m = new Map<string, { sign: number; date: string }>();
    for (const d of docsF) {
      if (d.doc_type !== "shipment" || d.status !== "posted" || d.kind !== "outgoing") continue;
      const day = String(d.issue_date ?? "").slice(0, 10);
      if ((from && day < from) || (to && day > to)) continue;
      m.set(d.id, { sign: d.is_return ? -1 : 1, date: day });
    }
    return m;
  }, [docsF, from, to]);

  const soldItems = useMemo(
    () => (items as any[]).flatMap((it) => {
      const doc = salesDocs.get(String(it.invoice_id));
      if (!doc) return [];
      const qty = doc.sign * Number(it.quantity || 0);
      const revenue = doc.sign * Number(it.sum ?? Number(it.quantity || 0) * Number(it.price || 0));
      const cost = qty * Number(productById.get(String(it.product_id))?.cost ?? 0);
      return [{ ...it, day: doc.date, qty, revenue, cost }];
    }),
    [items, salesDocs, productById],
  );

  const salesByDay = useMemo(() => {
    const m = new Map<string, { day: string; revenue: number; cost: number; docs: Set<string> }>();
    for (const r of soldItems) {
      const cur = m.get(r.day) ?? { day: r.day, revenue: 0, cost: 0, docs: new Set<string>() };
      cur.revenue += r.revenue;
      cur.cost += r.cost;
      cur.docs.add(String(r.invoice_id));
      m.set(r.day, cur);
    }
    return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [soldItems]);

  const salesTotals = useMemo(
    () => soldItems.reduce((s, r) => ({ revenue: s.revenue + r.revenue, cost: s.cost + r.cost }), { revenue: 0, cost: 0 }),
    [soldItems],
  );

  /** По товарам с ABC-классом по доле выручки. */
  const byProduct = useMemo(() => {
    const m = new Map<string, { key: string; name: string; qty: number; revenue: number; cost: number }>();
    for (const r of soldItems) {
      const key = String(r.product_id ?? r.name ?? "—");
      const cur = m.get(key) ?? { key, name: productById.get(key)?.name ?? r.name ?? "Без товара", qty: 0, revenue: 0, cost: 0 };
      cur.qty += r.qty;
      cur.revenue += r.revenue;
      cur.cost += r.cost;
      m.set(key, cur);
    }
    const rows = [...m.values()].sort((a, b) => b.revenue - a.revenue);
    const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    let acc = 0;
    return rows.map((r) => {
      acc += r.revenue;
      const share = acc / total;
      return { ...r, share: r.revenue / total, abc: share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C" };
    });
  }, [soldItems, productById]);

  /** Остатки склада с оценкой по себестоимости. */
  const stockRows = useMemo(() => {
    const m = new Map<string, { id: string; name: string; unit: string; qty: number; cost: number }>();
    for (const b of balances as any[]) {
      const p = productById.get(String(b.product_id));
      const cur = m.get(String(b.product_id)) ?? {
        id: String(b.product_id), name: p?.name ?? "Товар удалён", unit: p?.unit ?? "", qty: 0, cost: Number(p?.cost ?? 0),
      };
      cur.qty += Number(b.qty ?? 0);
      m.set(String(b.product_id), cur);
    }
    return [...m.values()].filter(r => Math.abs(r.qty) > 0.0001).sort((a, b) => b.qty * b.cost - a.qty * a.cost);
  }, [balances, productById]);

  const stockTotal = useMemo(() => stockRows.reduce((s, r) => s + r.qty * r.cost, 0), [stockRows]);

  const periodFilter = (
    <Card className="p-4 flex flex-wrap gap-4 items-end">
      <div className="space-y-1">
        <Label className="text-xs">С даты</Label>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">По дату</Label>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" />
      </div>
      {orgs.length > 1 && (
        <div className="space-y-1">
          <Label className="text-xs">Юрлицо</Label>
          <Select value={orgSel} onValueChange={setOrgSel}>
            <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все юрлица</SelectItem>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="ml-auto text-sm">
        Выручка: <b>{fmt.format(salesTotals.revenue)}</b>{" · "}
        Себестоимость: <b>{fmt.format(salesTotals.cost)}</b>{" · "}
        Прибыль:{" "}
        <b className={salesTotals.revenue - salesTotals.cost >= 0 ? "text-emerald-600" : "text-destructive"}>
          {fmt.format(salesTotals.revenue - salesTotals.cost)}
        </b>
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Отчёты</h1>

      <Tabs defaultValue="debts">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="debts">Задолженность</TabsTrigger>
          <TabsTrigger value="cash">Движение денег</TabsTrigger>
          <TabsTrigger value="sales">Продажи</TabsTrigger>
          <TabsTrigger value="profit">Прибыль по товарам</TabsTrigger>
          <TabsTrigger value="stock">Склад</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          {periodFilter}
          <Card className="p-0 overflow-hidden">
            <div className="flex justify-end p-3">
              <Button variant="outline" size="sm" onClick={() => downloadCsv("продажи-по-дням", salesByDay, [
                { header: "Дата", value: r => r.day.split("-").reverse().join(".") },
                { header: "Документов", value: r => r.docs.size },
                { header: "Выручка", value: r => r.revenue.toFixed(2) },
                { header: "Себестоимость", value: r => r.cost.toFixed(2) },
                { header: "Прибыль", value: r => (r.revenue - r.cost).toFixed(2) },
              ])}><Download className="h-4 w-4 mr-1" /> Excel</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">Документов</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="text-right">Себестоимость</TableHead>
                  <TableHead className="text-right">Прибыль</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesByDay.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">За период продаж нет</TableCell></TableRow>
                )}
                {salesByDay.map(r => (
                  <TableRow key={r.day}>
                    <TableCell>{r.day.split("-").reverse().join(".")}</TableCell>
                    <TableCell className="text-right">{r.docs.size}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.cost)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.revenue - r.cost >= 0 ? "" : "text-destructive"}`}>
                      {fmt.format(r.revenue - r.cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="profit" className="space-y-4">
          {periodFilter}
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between p-3 gap-2 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Класс A — товары, дающие первые 80% выручки, B — до 95%, C — остальные.
              </div>
              <Button variant="outline" size="sm" onClick={() => downloadCsv("прибыль-по-товарам", byProduct, [
                { header: "Товар", value: r => r.name },
                { header: "Количество", value: r => r.qty },
                { header: "Выручка", value: r => r.revenue.toFixed(2) },
                { header: "Себестоимость", value: r => r.cost.toFixed(2) },
                { header: "Прибыль", value: r => (r.revenue - r.cost).toFixed(2) },
                { header: "Доля выручки, %", value: r => (r.share * 100).toFixed(1) },
                { header: "Класс", value: r => r.abc },
              ])}><Download className="h-4 w-4 mr-1" /> Excel</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead className="text-right">Кол-во</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="text-right">Себестоимость</TableHead>
                  <TableHead className="text-right">Прибыль</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                  <TableHead className="text-center">Класс</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byProduct.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">За период продаж нет</TableCell></TableRow>
                )}
                {byProduct.map(r => (
                  <TableRow key={r.key}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.cost)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.revenue - r.cost >= 0 ? "" : "text-destructive"}`}>
                      {fmt.format(r.revenue - r.cost)}
                    </TableCell>
                    <TableCell className="text-right">{(r.share * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={r.abc === "A" ? "default" : r.abc === "B" ? "secondary" : "outline"}>{r.abc}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="stock" className="space-y-4">
          <Card className="p-4 flex flex-wrap gap-4 items-center">
            <div className="text-sm">Позиций на складе: <b>{stockRows.length}</b></div>
            <div className="ml-auto text-sm">Стоимость остатков: <b>{fmt.format(stockTotal)}</b></div>
            <Button variant="outline" size="sm" onClick={() => downloadCsv("остатки-склада", stockRows, [
              { header: "Товар", value: r => r.name },
              { header: "Ед.", value: r => r.unit },
              { header: "Остаток", value: r => r.qty },
              { header: "Себестоимость", value: r => r.cost.toFixed(2) },
              { header: "Сумма", value: r => (r.qty * r.cost).toFixed(2) },
            ])}><Download className="h-4 w-4 mr-1" /> Excel</Button>
          </Card>
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead>Ед.</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead className="text-right">Себестоимость</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockRows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Остатков нет</TableCell></TableRow>
                )}
                {stockRows.slice(0, 500).map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className={`text-right ${r.qty < 0 ? "text-destructive" : ""}`}>{r.qty}</TableCell>
                    <TableCell className="text-right">{fmt.format(r.cost)}</TableCell>
                    <TableCell className="text-right font-medium">{fmt.format(r.qty * r.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {stockRows.length > 500 && (
              <div className="p-3 text-xs text-muted-foreground">Показаны первые 500 позиций — полный список в выгрузке Excel.</div>
            )}
          </Card>
        </TabsContent>

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
