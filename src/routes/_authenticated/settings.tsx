import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Save, Search, Loader2, Plus, Trash2, Database, Check, Pencil } from "lucide-react";
import { lookupOrgByInn, lookupBankByBik } from "@/lib/dadata.functions";
import { useActiveWorkspaceId, activeWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Настройки — КабинетCRM" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ tab: typeof s.tab === "string" ? s.tab : undefined }),
  component: SettingsPage,
});

type Org = {
  id?: string;
  name: string;
  full_name: string;
  inn: string;
  kpp: string;
  ogrn: string;
  okpo: string;
  legal_address: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_bik: string;
  bank_corr_account: string;
  bank_account: string;
  director_name: string;
  accountant_name: string;
  taxation_system: string;
  is_primary: boolean;
  invoice_number_mask: string;
};

const empty: Org = {
  name: "", full_name: "", inn: "", kpp: "", ogrn: "", okpo: "",
  legal_address: "", phone: "", email: "",
  bank_name: "", bank_bik: "", bank_corr_account: "", bank_account: "",
  director_name: "", accountant_name: "", taxation_system: "usn_6", is_primary: true,
  invoice_number_mask: "{YYYY}-{MM}-{DD}-{NNN}",
};

function SettingsPage() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const { tab } = Route.useSearch();
  const { data: org } = useQuery({
    queryKey: ["my-organization", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("organizations").select("*")
        .eq("workspace_id", wsId)
        .order("is_primary", { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw error;
      return data as Org | null;
    },
  });

  const [form, setForm] = useState<Org>(empty);
  useEffect(() => { if (org) setForm(org as Org); }, [org]);

  const upd = (k: keyof Org, v: any) => setForm({ ...form, [k]: v });

  const innFn = useServerFn(lookupOrgByInn);
  const bikFn = useServerFn(lookupBankByBik);

  const innLookup = useMutation({
    mutationFn: () => innFn({ data: { inn: form.inn } }),
    onSuccess: (r) => {
      if (!r) { toast.error("Организация не найдена"); return; }
      setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) }));
      toast.success("Данные организации загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bikLookup = useMutation({
    mutationFn: () => bikFn({ data: { bik: form.bank_bik } }),
    onSuccess: (r) => {
      if (!r) { toast.error("Банк не найден"); return; }
      setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) }));
      toast.success("Реквизиты банка загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      if (!form.name.trim()) throw new Error("Укажите название организации");
      const payload = { ...form, user_id: user.id, workspace_id: wsId, is_primary: true };
      if (form.id) {
        const { error } = await (supabase as any).from("organizations").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("organizations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-organization"] }); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Реквизиты организации и справочники</p>
      </div>

      <Tabs defaultValue={tab || "org"}>
        <TabsList>
          <TabsTrigger value="workspaces">База данных</TabsTrigger>
          <TabsTrigger value="org">Организация</TabsTrigger>
          <TabsTrigger value="refs">Справочники</TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces" className="mt-5">
          <WorkspacesRef />
        </TabsContent>

        <TabsContent value="org" className="mt-5">
      <Card className="p-5 space-y-5">
        <div>
          <h2 className="font-medium mb-3">Основное</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Краткое название *</Label>
              <Input value={form.name} onChange={e => upd("name", e.target.value)} placeholder='ООО "Ромашка"' />
            </div>
            <div className="space-y-2">
              <Label>Полное наименование</Label>
              <Input value={form.full_name} onChange={e => upd("full_name", e.target.value)} placeholder='Общество с ограниченной ответственностью "Ромашка"' />
            </div>
            <div className="space-y-2">
              <Label>Система налогообложения</Label>
              <Select value={form.taxation_system} onValueChange={v => upd("taxation_system", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="osn">ОСН (общая, с НДС)</SelectItem>
                  <SelectItem value="usn_6">УСН «Доходы» (6%)</SelectItem>
                  <SelectItem value="usn_15">УСН «Доходы минус расходы» (15%)</SelectItem>
                  <SelectItem value="psn">Патент (ПСН)</SelectItem>
                  <SelectItem value="esxn">ЕСХН</SelectItem>
                  <SelectItem value="npd">НПД (самозанятый)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-medium mb-3">Реквизиты</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>ИНН</Label>
              <div className="flex gap-2">
                <Input value={form.inn} onChange={e => upd("inn", e.target.value)} />
                <Button type="button" size="icon" variant="outline" title="Найти по ИНН"
                  onClick={() => innLookup.mutate()} disabled={innLookup.isPending || !form.inn}>
                  {innLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2"><Label>КПП</Label><Input value={form.kpp} onChange={e => upd("kpp", e.target.value)} /></div>
            <div className="space-y-2"><Label>ОГРН / ОГРНИП</Label><Input value={form.ogrn} onChange={e => upd("ogrn", e.target.value)} /></div>
            <div className="space-y-2"><Label>ОКПО</Label><Input value={form.okpo} onChange={e => upd("okpo", e.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Юридический адрес</Label><Input value={form.legal_address} onChange={e => upd("legal_address", e.target.value)} /></div>
            <div className="space-y-2"><Label>Телефон</Label><Input value={form.phone} onChange={e => upd("phone", e.target.value)} /></div>
            <div className="space-y-2"><Label>Email</Label><Input value={form.email} onChange={e => upd("email", e.target.value)} /></div>
          </div>
        </div>

        <div>
          <h2 className="font-medium mb-3">Банковские реквизиты</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2"><Label>Название банка</Label><Input value={form.bank_name} onChange={e => upd("bank_name", e.target.value)} /></div>
            <div className="space-y-2">
              <Label>БИК</Label>
              <div className="flex gap-2">
                <Input value={form.bank_bik} onChange={e => upd("bank_bik", e.target.value)} />
                <Button type="button" size="icon" variant="outline" title="Найти по БИК"
                  onClick={() => bikLookup.mutate()} disabled={bikLookup.isPending || !form.bank_bik}>
                  {bikLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2"><Label>Корр. счёт</Label><Input value={form.bank_corr_account} onChange={e => upd("bank_corr_account", e.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Расчётный счёт</Label><Input value={form.bank_account} onChange={e => upd("bank_account", e.target.value)} /></div>
          </div>
        </div>

        <div>
          <h2 className="font-medium mb-3">Ответственные лица</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Руководитель</Label><Input value={form.director_name} onChange={e => upd("director_name", e.target.value)} placeholder="Иванов И.И." /></div>
            <div className="space-y-2"><Label>Главный бухгалтер</Label><Input value={form.accountant_name} onChange={e => upd("accountant_name", e.target.value)} placeholder="Петрова П.П." /></div>
          </div>
        </div>


        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Сохранить
          </Button>
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="refs" className="mt-5 space-y-5">
          <NumberingRef />
          <UnitsRef />
          <InvoiceStatusesRef />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Unit = { id: string; short_name: string; full_name: string | null };

function UnitsRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [short, setShort] = useState("");
  const [full, setFull] = useState("");

  const { data: units = [] } = useQuery({
    queryKey: ["units", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("units").select("id,short_name,full_name").eq("workspace_id", wsId).order("short_name");
      if (error) throw error;
      return data as Unit[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const s = short.trim();
      if (!s) throw new Error("Введите краткое название");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("units").insert({
        user_id: user.id, workspace_id: wsId, short_name: s, full_name: full.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["units"] }); setShort(""); setFull(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["units"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Единицы измерения</h2>
        <p className="text-sm text-muted-foreground mb-4">Используются при создании товаров и услуг</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 w-32">
            <Label>Краткое</Label>
            <Input placeholder="шт" value={short} onChange={e => setShort(e.target.value)} />
          </div>
          <div className="space-y-2 flex-1">
            <Label>Полное (необязательно)</Label>
            <Input placeholder="Штука" value={full} onChange={e => setFull(e.target.value)} />
          </div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {units.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока нет единиц</div>}
        {units.map(u => (
          <div key={u.id} className="flex items-center py-2 gap-3">
            <div className="w-32 font-medium">{u.short_name}</div>
            <div className="flex-1 text-sm text-muted-foreground">{u.full_name || "—"}</div>
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${u.short_name}"?`)) del.mutate(u.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

type InvStatus = { id: string; name: string; color: string; sort_order: number };

function InvoiceStatusesRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");

  const { data: statuses = [] } = useQuery({
    queryKey: ["invoice_statuses", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      let { data } = await (supabase as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order");
      if (!data || data.length === 0) {
        const defaults = [
          { name: "Новый", color: "#64748b", sort_order: 0 },
          { name: "Предоплата", color: "#eab308", sort_order: 1 },
          { name: "Оплачен", color: "#3b82f6", sort_order: 2 },
          { name: "Выполнен", color: "#22c55e", sort_order: 3 },
        ].map(s => ({ ...s, user_id: user.id, workspace_id: wsId }));
        await (supabase as any).from("invoice_statuses").insert(defaults);
        ({ data } = await (supabase as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order"));
      }
      return (data ?? []) as InvStatus[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название статуса");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const maxOrder = statuses.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const { error } = await (supabase as any).from("invoice_statuses").insert({
        user_id: user.id, workspace_id: wsId, name: n, color, sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice_statuses"] }); setName(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upd = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<InvStatus> }) => {
      const { error } = await supabase.from("invoice_statuses").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice_statuses"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_statuses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice_statuses"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Статусы накладных</h2>
        <p className="text-sm text-muted-foreground mb-4">Используются для отметки состояния (новый, оплачен, выполнен…)</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 flex-1">
            <Label>Название</Label>
            <Input placeholder="Новый" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2 w-24">
            <Label>Цвет</Label>
            <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 p-1" />
          </div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {statuses.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока нет статусов</div>}
        {statuses.map(s => (
          <StatusRow key={s.id} status={s} onSave={(patch) => upd.mutate({ id: s.id, patch })} onDelete={() => { if (confirm(`Удалить "${s.name}"?`)) del.mutate(s.id); }} />
        ))}
      </div>
    </Card>
  );
}

function StatusRow({ status, onSave, onDelete }: { status: InvStatus; onSave: (p: Partial<InvStatus>) => void; onDelete: () => void }) {
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  useEffect(() => { setName(status.name); setColor(status.color); }, [status.id, status.name, status.color]);
  const dirty = name !== status.name || color !== status.color;
  return (
    <div className="flex items-center py-2 gap-3">
      <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-12 p-1" />
      <Input value={name} onChange={e => setName(e.target.value)} className="flex-1" />
      {dirty && (
        <Button size="sm" onClick={() => onSave({ name, color })}>
          <Save className="h-4 w-4 mr-1" />Сохранить
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function NumberingRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const { data: org } = useQuery({
    queryKey: ["my-organization", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (supabase as any).from("organizations").select("id,invoice_number_mask,invoice_number_start,name").eq("workspace_id", wsId).order("is_primary", { ascending: false }).limit(1).maybeSingle()).data,
  });
  const [mask, setMask] = useState("");
  const [start, setStart] = useState<number>(1);
  useEffect(() => {
    if (org) {
      setMask((org as any).invoice_number_mask ?? "{YYYY}-{MM}-{DD}-{NNN}");
      setStart(Number((org as any).invoice_number_start ?? 1));
    }
  }, [org]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const payload = { invoice_number_mask: mask, invoice_number_start: Math.max(1, Math.floor(Number(start) || 1)) };
      if (org && (org as any).id) {
        const { error } = await (supabase as any).from("organizations").update(payload).eq("id", (org as any).id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("organizations").insert({ user_id: user.id, workspace_id: wsId, name: "Моя организация", is_primary: true, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-organization"] }); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h2 className="font-medium mb-1">Нумерация накладных</h2>
        <p className="text-sm text-muted-foreground mb-4">Маска применяется к номеру новой накладной</p>
      </div>
      <div className="flex gap-2 items-end max-w-2xl flex-wrap">
        <div className="space-y-2 flex-1 min-w-[240px]">
          <Label>Маска номера</Label>
          <Input value={mask} onChange={e => setMask(e.target.value)} placeholder="{YYYY}-{MM}-{DD}-{NNN}" />
        </div>
        <div className="space-y-2 w-40">
          <Label>Начинать с номера</Label>
          <Input type="number" min={1} value={start} onChange={e => setStart(Number(e.target.value))} />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" />Сохранить</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Подстановки: <code>{"{YYYY}"}</code>, <code>{"{YY}"}</code>, <code>{"{MM}"}</code>, <code>{"{DD}"}</code>, <code>{"{N}"}</code>, <code>{"{NN}"}</code>, <code>{"{NNN}"}</code>, <code>{"{NNNN}"}</code>
      </p>
    </Card>
  );
}
