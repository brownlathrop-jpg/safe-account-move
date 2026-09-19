import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  teamList,
  teamInvite,
  teamSetRole,
  teamRemove,
  teamRevokeInvite,
  teamMyRole,
  teamSetOrg,
  teamWorkspaceHistory,
} from "@/lib/team.functions";
import { useOrganizations } from "@/lib/organizations";
import { useViewLog } from "@/hooks/use-view-log";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
  head: () => ({
    meta: [
      { title: "Сотрудники и роли — КабинетCRM" },
      {
        name: "description",
        content: "Приглашайте сотрудников в рабочую базу, выдавайте роли и смотрите историю изменений документов.",
      },
      { property: "og:title", content: "Сотрудники и роли — КабинетCRM" },
      {
        property: "og:description",
        content: "Доступ сотрудников к базе, роли и журнал изменений документов.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const ROLES = [
  { value: "manager", label: "Менеджер", hint: "Документы, товары, контрагенты, оплаты" },
  { value: "storekeeper", label: "Кладовщик", hint: "Товары и склад" },
  { value: "viewer", label: "Наблюдатель", hint: "Только просмотр" },
] as const;

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  storekeeper: "Кладовщик",
  viewer: "Наблюдатель",
};

const TABLE_LABEL: Record<string, string> = {
  invoices: "Документ",
  invoice_items: "Позиция документа",
  invoice_payments: "Оплата",
  products: "Товар",
  partners: "Контрагент",
  stock_movements: "Движение склада",
  stock_receipts: "Поступление",
};

const SECTION_LABEL: Record<string, string> = {
  reports: "Отчёты",
  kudir: "КУДиР",
  cashbook: "Кассовая книга",
  cash: "Касса и оплаты",
  admin: "Админка",
  team: "Сотрудники и роли",
  export: "Выгрузка данных",
  settings: "Настройки базы",
};

const OP_LABEL: Record<string, string> = {
  insert: "создано",
  update: "изменено",
  delete: "удалено",
};

/** Строка журнала человеческим языком. */
function logText(h: { doc_table: string; op: string }) {
  if (h.op === "view" || h.doc_table.startsWith("section:")) {
    const key = h.doc_table.replace("section:", "");
    return `открыл раздел «${SECTION_LABEL[key] ?? key}»`;
  }
  return `${TABLE_LABEL[h.doc_table] ?? h.doc_table} ${OP_LABEL[h.op] ?? h.op}`;
}

function TeamPage() {
  useViewLog("team");
  const wsId = useActiveWorkspaceId();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("manager");
  const [logKind, setLogKind] = useState<"all" | "changes" | "views">("all");
  const { data: orgs = [] } = useOrganizations(wsId);

  const { data: myRole } = useQuery({
    queryKey: ["my-role", wsId],
    enabled: !!wsId,
    queryFn: async () => (await teamMyRole({ data: { workspaceId: wsId! } })).data as string | null,
  });
  const isOwner = myRole === "owner";

  const { data: team } = useQuery({
    queryKey: ["team", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const res = await teamList({ data: { workspaceId: wsId! } });
      if (res.error) throw new Error(res.error.message);
      return res.data as any;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["ws-history", wsId, logKind],
    enabled: !!wsId,
    queryFn: async () => {
      const res = await teamWorkspaceHistory({ data: { workspaceId: wsId!, kind: logKind } });
      if (res.error) throw new Error(res.error.message);
      return (res.data ?? []) as any[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["team", wsId] });

  const invite = useMutation({
    mutationFn: async () => {
      const res = await teamInvite({ data: { workspaceId: wsId!, email: email.trim(), role } });
      if (res.error) throw new Error(res.error.message);
      return res.data as { existingUser: boolean };
    },
    onSuccess: (d) => {
      setEmail("");
      refresh();
      toast.success(
        d?.existingUser
          ? "Доступ выдан — сотрудник увидит базу при следующем входе"
          : "Приглашение отправлено на почту",
      );
    },
    onError: (e: any) => toast.error(e.message),
  });

  const changeOrg = useMutation({
    mutationFn: async (v: { memberId: string; orgId: string | null }) => {
      const res = await teamSetOrg({ data: { workspaceId: wsId!, ...v } });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["my-org"] });
      toast.success("Юрлицо сотрудника изменено");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: async (v: { memberId: string; role: string }) => {
      const res = await teamSetRole({ data: { workspaceId: wsId!, ...v } });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      refresh();
      toast.success("Роль изменена");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await teamRemove({ data: { workspaceId: wsId!, memberId } });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      refresh();
      toast.success("Доступ отозван");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const res = await teamRevokeInvite({ data: { workspaceId: wsId!, token } });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      refresh();
      toast.success("Приглашение отменено");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <p className="text-sm text-muted-foreground">
          Кто работает в этой базе, с какими правами, и что менялось в документах.
        </p>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">Доступ к базе</TabsTrigger>
          <TabsTrigger value="history">История изменений</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-3 space-y-4">
          {isOwner && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Пригласить сотрудника</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  placeholder="e-mail сотрудника"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="sm:max-w-xs"
                />
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label} — {r.hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => invite.mutate()}
                  disabled={!email.trim() || invite.isPending}
                >
                  Пригласить
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Есть доступ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {team?.owner && (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{team.owner.name || team.owner.email}</div>
                    <div className="text-muted-foreground">{team.owner.email}</div>
                  </div>
                  <Badge>Владелец</Badge>
                </div>
              )}
              {(team?.members ?? []).map((m: any) => (
                <div
                  key={m.id}
                  className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{m.name || m.email}</div>
                    <div className="text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <>
                        {orgs.length > 0 && (
                          <Select
                            value={m.organization_id ?? "none"}
                            onValueChange={(v) => changeOrg.mutate({ memberId: m.id, orgId: v === "none" ? null : v })}
                          >
                            <SelectTrigger className="w-48" title="Юрлицо, от которого работает этот вход">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Основное юрлицо</SelectItem>
                              {orgs.map((o) => (
                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Select
                          value={m.role}
                          onValueChange={(v) => changeRole.mutate({ memberId: m.id, role: v })}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => remove.mutate(m.id)}
                        >
                          Убрать
                        </Button>
                      </>
                    ) : (
                      <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                    )}
                  </div>
                </div>
              ))}
              {!team?.members?.length && (
                <div className="text-sm text-muted-foreground">
                  Пока никого нет — пригласите сотрудника по e-mail.
                </div>
              )}
            </CardContent>
          </Card>

          {!!team?.invites?.length && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Приглашения отправлены</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {team.invites.map((i: any) => (
                  <div
                    key={i.token}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{i.email}</div>
                      <div className="text-muted-foreground">{ROLE_LABEL[i.role] ?? i.role}</div>
                    </div>
                    {isOwner && (
                      <Button variant="outline" size="sm" onClick={() => revoke.mutate(i.token)}>
                        Отменить
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <Card>
            <CardHeader className="pb-3 flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Журнал действий</CardTitle>
              <div className="flex gap-1">
                {(
                  [
                    { v: "all", l: "Всё" },
                    { v: "changes", l: "Изменения" },
                    { v: "views", l: "Просмотры" },
                  ] as const
                ).map((o) => (
                  <Button
                    key={o.v}
                    size="sm"
                    variant={logKind === o.v ? "default" : "outline"}
                    onClick={() => setLogKind(o.v)}
                  >
                    {o.l}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="text-sm text-muted-foreground">Записей пока нет.</div>
              ) : (
                <div className="divide-y text-sm">
                  {history.map((h: any) => (
                    <div key={h.id} className="flex flex-wrap gap-x-2 py-2">
                      <span className="text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("ru-RU")}
                      </span>
                      <span className="font-medium">{h.user_email || "—"}</span>
                      <span>{logText(h)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
