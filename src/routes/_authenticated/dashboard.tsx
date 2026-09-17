import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TrendingUp, TrendingDown, Package, FileText, CalendarIcon } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from "recharts";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Аналитика — КабинетCRM" }] }),
  component: Dashboard,
});

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

type Period = "month" | "quarter" | "year" | "custom";

function rangeFor(period: Period, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "month") return { from: new Date(end.getFullYear(), end.getMonth(), 1), to: end };
  if (period === "quarter") {
    const q = Math.floor(end.getMonth() / 3);
    return { from: new Date(end.getFullYear(), q * 3, 1), to: end };
  }
  if (period === "year") return { from: new Date(end.getFullYear(), 0, 1), to: end };
  return { from: from ?? end, to: to ?? end };
}

function toKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function Dashboard() {
  const wsId = useActiveWorkspaceId();
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const { from, to } = useMemo(() => rangeFor(period, customFrom, customTo), [period, customFrom, customTo]);

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", wsId, toKey(from), toKey(to)],
    enabled: !!wsId,
    queryFn: async () => {
      const [invoicesRes, productsRes] = await Promise.all([
        (db as any)
          .from("invoices")
          .select("kind,status,total,issue_date,created_at")
          .eq("status", "posted")
          .eq("workspace_id", wsId)
          .gte("issue_date", toKey(from))
          .lte("issue_date", toKey(to)),
        (db as any).from("products").select("id,stock,price").eq("workspace_id", wsId),
      ]);
      const invoices = (invoicesRes.data ?? []) as any[];
      const products = (productsRes.data ?? []) as any[];
      const sales = invoices.filter(i => i.kind === "outgoing").reduce((s, i) => s + Number(i.total), 0);
      const purchases = invoices.filter(i => i.kind === "incoming").reduce((s, i) => s + Number(i.total), 0);
      const stockValue = products.reduce((s, p) => s + Number(p.stock) * Number(p.price), 0);

      const msDay = 86400000;
      const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / msDay) + 1);
      const groupByMonth = spanDays > 92;
      const days: { date: string; sales: number; purchases: number }[] = [];
      const keyOf = (d: Date) => (groupByMonth ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));
      const labelOf = (k: string) => (groupByMonth ? k.slice(2) : k.slice(5));

      if (groupByMonth) {
        const cur = new Date(from.getFullYear(), from.getMonth(), 1);
        while (cur <= to) {
          const k = cur.toISOString().slice(0, 7);
          days.push({ date: labelOf(k), sales: 0, purchases: 0 });
          cur.setMonth(cur.getMonth() + 1);
        }
      } else {
        for (let t = from.getTime(); t <= to.getTime(); t += msDay) {
          const k = new Date(t).toISOString().slice(0, 10);
          days.push({ date: labelOf(k), sales: 0, purchases: 0 });
        }
      }

      invoices.forEach(inv => {
        const d = new Date(String(inv.issue_date));
        const label = labelOf(keyOf(d));
        const bucket = days.find(x => x.date === label);
        if (!bucket) return;
        if (inv.kind === "outgoing") bucket.sales += Number(inv.total);
        else bucket.purchases += Number(inv.total);
      });

      return {
        sales, purchases, profit: sales - purchases,
        productsCount: products.length, invoicesCount: invoices.length,
        stockValue, days,
      };
    },
  });

  const cards = [
    { label: "Продажи", value: fmt.format(stats?.sales ?? 0), icon: TrendingUp, tone: "text-success" },
    { label: "Закупки", value: fmt.format(stats?.purchases ?? 0), icon: TrendingDown, tone: "text-primary" },
    { label: "Прибыль", value: fmt.format(stats?.profit ?? 0), icon: TrendingUp, tone: "text-foreground" },
    { label: "Стоимость склада", value: fmt.format(stats?.stockValue ?? 0), icon: Package, tone: "text-foreground" },
  ];

  const periods: { key: Period; label: string }[] = [
    { key: "month", label: "Месяц" },
    { key: "quarter", label: "Квартал" },
    { key: "year", label: "Год" },
    { key: "custom", label: "Период" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Аналитика</h1>
          <p className="text-sm text-muted-foreground">
            {format(from, "d MMM yyyy", { locale: ru })} — {format(to, "d MMM yyyy", { locale: ru })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-input overflow-hidden">
            {periods.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  period === p.key ? "bg-primary text-primary-foreground" : "bg-transparent hover:bg-accent",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="font-normal">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {customFrom ? format(customFrom, "dd.MM.yyyy") : "От"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="font-normal">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {customTo ? format(customTo, "dd.MM.yyyy") : "До"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Card key={c.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{c.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-medium mb-4">Динамика</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={stats?.days ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="sales" stroke="var(--chart-3)" strokeWidth={2} name="Продажи" dot={false} />
                <Line type="monotone" dataKey="purchases" stroke="var(--chart-1)" strokeWidth={2} name="Закупки" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-medium mb-4">Объём операций</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stats?.days ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Bar dataKey="sales" fill="var(--chart-3)" name="Продажи" radius={[4, 4, 0, 0]} />
                <Bar dataKey="purchases" fill="var(--chart-1)" name="Закупки" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Товаров в справочнике</div>
            <div className="text-2xl font-semibold mt-1">{stats?.productsCount ?? 0}</div>
          </div>
          <Package className="h-8 w-8 text-muted-foreground" />
        </Card>
        <Card className="p-5 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Проведённых накладных</div>
            <div className="text-2xl font-semibold mt-1">{stats?.invoicesCount ?? 0}</div>
          </div>
          <FileText className="h-8 w-8 text-muted-foreground" />
        </Card>
      </div>
    </div>
  );
}
