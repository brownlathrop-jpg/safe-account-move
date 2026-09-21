// Админка: доступна только пользователю с признаком администратора.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  adminListUsers,
  adminStats,
  adminCreateUser,
  adminSetPassword,
  adminSetAdmin,
  adminDeleteUser,
  adminSelect,
} from "@/lib/admin.functions";
import { useViewLog } from "@/hooks/use-view-log";
import {
  adminBillingList,
  adminPayments,
  adminSetPlan,
  adminSuspend,
  adminAddPayment,
  adminSetExtras,
} from "@/lib/billing.functions";
import {
  ADDONS,
  ADDON_IDS,
  EXTRA_MEMBER_PRICE,
  PLANS,
  PLAN_IDS,
  limitsOf,
  limitText,
  membersLimit,
  monthlyPrice,
  planId,
  planLabel,
  type AddonId,
  type PlanId,
} from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Админка — КабинетCRM" },
      { name: "description", content: "Управление пользователями и состоянием базы КабинетCRM." },
      { property: "og:title", content: "Админка — КабинетCRM" },
      { property: "og:description", content: "Управление пользователями и состоянием базы КабинетCRM." },
    ],
  }),
});

const call = async (fn: any, data?: any) => {
  const res: any = await fn({ data: data ?? {} });
  if (res?.error) throw new Error(res.error.message);
  return res.data;
};

// Понятные названия таблиц для раздела «Состояние базы»
const TABLE_LABELS: Record<string, string> = {
  products: "Товары и услуги",
  product_folders: "Папки товаров",
  partners: "Контрагенты",
  invoices: "Документы",
  invoice_items: "Строки документов",
  invoice_payments: "Оплаты",
  stock_movements: "Движения по складу",
  stock_receipts: "Поступления на склад",
  workspaces: "Базы",
  app_users: "Пользователи",
  workspace_members: "Сотрудники",
  workspace_invites: "Приглашения",
  document_log: "История изменений",
  sessions: "Сессии",
  files: "Файлы",
  warehouses: "Склады",
  doc_statuses: "Статусы документов",
};


function AdminPage() {
  useViewLog("admin");
  const qc = useQueryClient();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    db.auth.getUser().then(({ data }) => {
      setAllowed(!!(data.user?.user_metadata as any)?.is_admin);
    });
  }, []);

  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => call(adminListUsers),
    enabled: allowed === true,
  });
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => call(adminStats),
    enabled: allowed === true,
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("select * from products limit 20");
  const [rows, setRows] = useState<any[] | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const createUser = useMutation({
    mutationFn: () => call(adminCreateUser, { email, password, name }),
    onSuccess: () => {
      setEmail(""); setName(""); setPassword("");
      toast.success("Пользователь создан");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setPass = useMutation({
    mutationFn: (v: { userId: string; password: string }) => call(adminSetPassword, v),
    onSuccess: () => toast.success("Пароль изменён"),
    onError: (e: any) => toast.error(e.message),
  });

  const toggleAdmin = useMutation({
    mutationFn: (v: { userId: string; isAdmin: boolean }) => call(adminSetAdmin, v),
    onSuccess: () => { toast.success("Сохранено"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeUser = useMutation({
    mutationFn: (userId: string) => call(adminDeleteUser, { userId }),
    onSuccess: () => { toast.success("Удалён"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  const clients = useQuery({
    queryKey: ["admin-billing"],
    queryFn: () => call(adminBillingList),
    enabled: allowed === true,
  });

  const [payFor, setPayFor] = useState<string | null>(null);
  const [payMonths, setPayMonths] = useState("12");
  const [payAmount, setPayAmount] = useState("");
  const [payPlan, setPayPlan] = useState<PlanId>("ip");
  const [payExtra, setPayExtra] = useState("0");
  const [payAddons, setPayAddons] = useState<AddonId[]>([]);
  const [payComment, setPayComment] = useState("");

  const payments = useQuery({
    queryKey: ["admin-payments", payFor],
    queryFn: () => call(adminPayments, { workspaceId: payFor }),
    enabled: allowed === true && !!payFor,
  });

  const refreshClients = () => {
    qc.invalidateQueries({ queryKey: ["admin-billing"] });
    qc.invalidateQueries({ queryKey: ["admin-payments"] });
  };

  const setPlan = useMutation({
    mutationFn: (v: { workspaceId: string; plan: PlanId }) => call(adminSetPlan, v),
    onSuccess: () => { toast.success("Тариф сохранён"); refreshClients(); },
    onError: (e: any) => toast.error(e.message),
  });

  const suspend = useMutation({
    mutationFn: (v: { workspaceId: string; suspended: boolean }) => call(adminSuspend, v),
    onSuccess: () => { toast.success("Сохранено"); refreshClients(); },
    onError: (e: any) => toast.error(e.message),
  });

  const setExtras = useMutation({
    mutationFn: () => call(adminSetExtras, {
      workspaceId: payFor,
      extraMembers: Number(payExtra) || 0,
      addons: payAddons,
    }),
    onSuccess: () => { toast.success("Опции сохранены"); refreshClients(); },
    onError: (e: any) => toast.error(e.message),
  });

  const addPayment = useMutation({
    mutationFn: () => call(adminAddPayment, {
      workspaceId: payFor,
      months: Number(payMonths) || 1,
      amount: Number(String(payAmount).replace(",", ".")) || 0,
      plan: payPlan,
      comment: payComment,
    }),
    onSuccess: () => {
      toast.success("Оплата зарегистрирована, доступ продлён");
      setPayAmount(""); setPayComment("");
      refreshClients();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const runQuery = useMutation({
    mutationFn: () => call(adminSelect, { query }),
    onSuccess: (data: any) => setRows(data ?? []),
    onError: (e: any) => toast.error(e.message),
  });

  if (allowed === null) return <div className="p-6 text-sm text-muted-foreground">Загрузка…</div>;
  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted-foreground">Этот раздел доступен только администратору.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-semibold">Админка</h1>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="clients">Клиенты и оплата</TabsTrigger>
          <TabsTrigger value="base">Состояние базы</TabsTrigger>
          <TabsTrigger value="sql">Запросы</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Новый пользователь</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4 md:items-end">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@mail.ru" />
              </div>
              <div className="space-y-1">
                <Label>Имя</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Менеджер" />
              </div>
              <div className="space-y-1">
                <Label>Пароль</Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="не короче 8 символов" />
              </div>
              <Button onClick={() => createUser.mutate()} disabled={createUser.isPending}>Создать</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Все пользователи</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Имя</TableHead>
                    <TableHead className="text-right">Базы</TableHead>
                    <TableHead className="text-right">Товары</TableHead>
                    <TableHead>Админ</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users.data ?? []).map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell>{u.name}</TableCell>
                      <TableCell className="text-right">{u.workspaces}</TableCell>
                      <TableCell className="text-right">{u.products}</TableCell>
                      <TableCell>
                        <Switch
                          checked={!!u.is_admin}
                          onCheckedChange={(v) => toggleAdmin.mutate({ userId: u.id, isAdmin: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => {
                            const p = window.prompt(`Новый пароль для ${u.email}`);
                            if (p) setPass.mutate({ userId: u.id, password: p });
                          }}
                        >Пароль</Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => {
                            if (window.confirm(`Удалить ${u.email}?`)) removeUser.mutate(u.id);
                          }}
                        >Удалить</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Клиенты (базы), тарифы и срок доступа</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>База</TableHead>
                    <TableHead>Владелец</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Оплачено до</TableHead>
                    <TableHead>Товары</TableHead>
                    <TableHead>Контрагенты</TableHead>
                    <TableHead>Документов за месяц</TableHead>
                    <TableHead>Сотрудники</TableHead>
                    <TableHead>Картинки</TableHead>
                    <TableHead>Приостановлена</TableHead>
                    <TableHead className="text-right">Оплата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(clients.data ?? []).map((c: any) => {
                    const lim = limitsOf(c.plan);
                    const until = c.paid_until ? new Date(c.paid_until) : null;
                    const expired = !!until && until.getTime() < Date.now();
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.owner ?? "—"}
                          {!c.email_confirmed_at && <span className="ml-1 text-xs text-amber-600">почта не подтверждена</span>}
                        </TableCell>
                        <TableCell>
                          <select
                            className="rounded border bg-background px-2 py-1 text-sm"
                            value={planId(c.plan)}
                            onChange={(e) => setPlan.mutate({ workspaceId: c.id, plan: e.target.value as PlanId })}
                          >
                            {PLAN_IDS.map((p) => (
                              <option key={p} value={p}>{PLANS[p].label}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell className={expired ? "text-destructive font-medium" : ""}>
                          {until ? until.toLocaleDateString("ru-RU") : "—"}
                        </TableCell>
                        <TableCell>{limitText(c.products, lim.products)}</TableCell>
                        <TableCell>{limitText(c.partners, lim.partners)}</TableCell>
                        <TableCell>{limitText(c.docs_month, lim.docsPerMonth)}</TableCell>
                        <TableCell>
                          {limitText(Math.max(Number(c.members ?? 0), 1), membersLimit(c.plan, Number(c.extra_members ?? 0)))}
                        </TableCell>
                        <TableCell>{limitText(c.storageMb, lim.storageMb)}</TableCell>
                        <TableCell>
                          <Switch
                            checked={!!c.suspended}
                            onCheckedChange={(v) => suspend.mutate({ workspaceId: c.id, suspended: v })}
                          />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant={payFor === c.id ? "default" : "outline"}
                            onClick={() => {
                              const p: PlanId = planId(c.plan) === "free" ? "ip" : planId(c.plan);
                              const extra = Number(c.extra_members ?? 0) || 0;
                              const addons = ((c.addons ?? []) as string[]).filter((a): a is AddonId =>
                                (ADDON_IDS as string[]).includes(a),
                              );
                              setPayFor(c.id);
                              setPayPlan(p);
                              setPayExtra(String(extra));
                              setPayAddons(addons);
                              setPayAmount(String(monthlyPrice(p, extra, addons) * 12));
                            }}
                          >Оплата</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {payFor && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Оплата и продление: {(clients.data ?? []).find((c: any) => c.id === payFor)?.name ?? ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-5 md:items-end">
                  <div className="space-y-1">
                    <Label>Тариф</Label>
                    <select
                      className="w-full rounded border bg-background px-2 py-2 text-sm"
                      value={payPlan}
                      onChange={(e) => {
                        const p = e.target.value as PlanId;
                        setPayPlan(p);
                        setPayAmount(String(monthlyPrice(p, Number(payExtra) || 0, payAddons) * (Number(payMonths) || 1)));
                      }}
                    >
                      {PLAN_IDS.map((p) => <option key={p} value={p}>{PLANS[p].label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Месяцев</Label>
                    <Input
                      value={payMonths}
                      onChange={(e) => {
                        setPayMonths(e.target.value);
                        setPayAmount(String(monthlyPrice(payPlan, Number(payExtra) || 0, payAddons) * (Number(e.target.value) || 1)));
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Сумма, ₽</Label>
                    <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Комментарий</Label>
                    <Input value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="счёт, договор…" />
                  </div>
                  <Button onClick={() => addPayment.mutate()} disabled={addPayment.isPending}>
                    Продлить доступ
                  </Button>
                </div>

                <div className="grid gap-3 rounded border p-3 md:grid-cols-4 md:items-end">
                  <div className="space-y-1">
                    <Label>Доп. пользователей (+{EXTRA_MEMBER_PRICE} ₽/мес)</Label>
                    <Input
                      value={payExtra}
                      onChange={(e) => {
                        setPayExtra(e.target.value);
                        setPayAmount(String(monthlyPrice(payPlan, Number(e.target.value) || 0, payAddons) * (Number(payMonths) || 1)));
                      }}
                    />
                  </div>
                  {ADDON_IDS.map((a) => (
                    <label key={a} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={payAddons.includes(a)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...payAddons, a]
                            : payAddons.filter((x) => x !== a);
                          setPayAddons(next);
                          setPayAmount(String(monthlyPrice(payPlan, Number(payExtra) || 0, next) * (Number(payMonths) || 1)));
                        }}
                      />
                      {ADDONS[a].label} (+{ADDONS[a].priceMonth} ₽/мес)
                    </label>
                  ))}
                  <Button variant="outline" onClick={() => setExtras.mutate()} disabled={setExtras.isPending}>
                    Сохранить опции
                  </Button>
                </div>

                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left">Дата</th>
                        <th className="px-2 py-1 text-left">Тариф</th>
                        <th className="px-2 py-1 text-right">Месяцев</th>
                        <th className="px-2 py-1 text-right">Сумма</th>
                        <th className="px-2 py-1 text-left">Оплачено до</th>
                        <th className="px-2 py-1 text-left">Комментарий</th>
                        <th className="px-2 py-1 text-left">Кто внёс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payments.data ?? []).map((p: any) => (
                        <tr key={p.id} className="border-t">
                          <td className="px-2 py-1">{new Date(p.created_at).toLocaleString("ru-RU")}</td>
                          <td className="px-2 py-1">{planLabel(p.plan)}</td>
                          <td className="px-2 py-1 text-right">{p.months}</td>
                          <td className="px-2 py-1 text-right">{Number(p.amount ?? 0).toLocaleString("ru-RU")}</td>
                          <td className="px-2 py-1">{p.paid_until ? new Date(p.paid_until).toLocaleDateString("ru-RU") : "—"}</td>
                          <td className="px-2 py-1">{p.comment}</td>
                          <td className="px-2 py-1 text-muted-foreground">{p.author ?? "—"}</td>
                        </tr>
                      ))}
                      {!(payments.data ?? []).length && (
                        <tr><td className="px-2 py-2 text-muted-foreground" colSpan={7}>Оплат пока нет</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="base">
          <Card>
            <CardHeader><CardTitle className="text-base">Состояние базы</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>Размер базы: <b>{stats.data?.size ?? "—"}</b></div>
              <div>Неудачных входов за сутки: <b>{stats.data?.sessions ?? 0}</b></div>
              <div className="font-medium pt-1">Итого по всем базам</div>
              <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3">
                {(stats.data?.counts ?? []).map((c: any) => (
                  <div key={c.label ?? c.table} className="flex justify-between rounded border px-3 py-1.5">
                    <span className="text-muted-foreground">{c.label ?? TABLE_LABELS[c.table] ?? c.table}</span>
                    <span className="font-medium">{c.count}</span>
                  </div>
                ))}
              </div>
              <div className="font-medium pt-2">По каждой базе</div>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">База</th>
                      <th className="px-2 py-1 text-left">Владелец</th>
                      <th className="px-2 py-1 text-right">Товары</th>
                      <th className="px-2 py-1 text-right">Папки</th>
                      <th className="px-2 py-1 text-right">Контрагенты</th>
                      <th className="px-2 py-1 text-right">Документы</th>
                      <th className="px-2 py-1 text-right">Строки</th>
                      <th className="px-2 py-1 text-right">Движения</th>
                      <th className="px-2 py-1 text-right">Поступления</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.data?.byWorkspace ?? []).map((w: any) => (
                      <tr key={w.id} className="border-t">
                        <td className="px-2 py-1">{w.name}</td>
                        <td className="px-2 py-1 text-muted-foreground">{w.owner ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{w.products}</td>
                        <td className="px-2 py-1 text-right">{w.folders}</td>
                        <td className="px-2 py-1 text-right">{w.partners}</td>
                        <td className="px-2 py-1 text-right">{w.invoices}</td>
                        <td className="px-2 py-1 text-right">{w.invoice_items}</td>
                        <td className="px-2 py-1 text-right">{w.stock_movements}</td>
                        <td className="px-2 py-1 text-right">{w.stock_receipts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sql">
          <Card>
            <CardHeader><CardTitle className="text-base">Чтение данных (только SELECT, до 200 строк)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={4} className="font-mono text-xs" />
              <Button onClick={() => runQuery.mutate()} disabled={runQuery.isPending}>Выполнить</Button>
              {rows && (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>{Object.keys(rows[0] ?? {}).map((k) => <th key={k} className="px-2 py-1 text-left">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t">
                          {Object.keys(rows[0] ?? {}).map((k) => (
                            <td key={k} className="px-2 py-1 align-top">
                              {typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
