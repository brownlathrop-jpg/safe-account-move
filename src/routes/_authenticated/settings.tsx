import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Save, Search, Loader2, Plus, Trash2, Database, Check, Pencil } from "lucide-react";
import { lookupOrgByInn, lookupBankByBik } from "@/lib/dadata.functions";
import { useActiveWorkspaceId, activeWorkspace } from "@/lib/workspace";
import { WarehousesRef, ProductTypesRef, PriceTypesRef, MyPriceTypeRef, CashflowItemsRef, BanksRef, DiscountsRef } from "@/components/settings-simple-refs";
import { BankAccountsEditor } from "@/components/bank-accounts-editor";
import { Import1CPanel } from "@/components/import-1c-panel";
import { PriceImportPanel } from "@/components/price-import-panel";
import { KktSettingsPanel } from "@/components/kkt-settings-panel";

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
      const { data, error } = await (db as any)
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
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      if (!form.name.trim()) throw new Error("Укажите название организации");
      const payload = { ...form, user_id: user.id, workspace_id: wsId, is_primary: true };
      if (form.id) {
        const { error } = await (db as any).from("organizations").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await (db as any).from("organizations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-organization"] }); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 max-w-5xl text-sm">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">Настройки</h1>
        <p className="text-xs text-muted-foreground">Реквизиты организации и справочники</p>
      </div>

      <Tabs defaultValue={tab || "org"}>
        <div className="sticky top-0 z-20 -mx-2 px-2 py-1 bg-background/95 backdrop-blur border-b">
        <TabsList className="h-8">
          <TabsTrigger value="workspaces">База данных</TabsTrigger>
          <TabsTrigger value="org">Организация</TabsTrigger>
          <TabsTrigger value="refs">Справочники</TabsTrigger>
          <TabsTrigger value="kkt">Касса</TabsTrigger>
          <TabsTrigger value="import">Импорт из 1С</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="workspaces" className="mt-3">
          <WorkspacesRef />
        </TabsContent>

        <TabsContent value="org" className="mt-3">
      <Card className="p-3 space-y-3">
        <div>
          <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-2">Основное</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Краткое название *</Label>
              <Input className="h-8" value={form.name} onChange={e => upd("name", e.target.value)} placeholder='ООО "Ромашка"' />
            </div>
            <div className="space-y-1">
              <Label>Полное наименование</Label>
              <Input className="h-8" value={form.full_name} onChange={e => upd("full_name", e.target.value)} placeholder='Общество с ограниченной ответственностью "Ромашка"' />
            </div>
            <div className="space-y-1">
              <Label>Система налогообложения</Label>
              <Select value={form.taxation_system} onValueChange={v => upd("taxation_system", v)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
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
          <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-2">Реквизиты</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label>ИНН</Label>
              <div className="flex gap-1">
                <Input className="h-8" value={form.inn} onChange={e => upd("inn", e.target.value)} />
                <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Найти по ИНН"
                  onClick={() => innLookup.mutate()} disabled={innLookup.isPending || !form.inn}>
                  {innLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1"><Label>КПП</Label><Input className="h-8" value={form.kpp} onChange={e => upd("kpp", e.target.value)} /></div>
            <div className="space-y-1"><Label>ОГРН / ОГРНИП</Label><Input className="h-8" value={form.ogrn} onChange={e => upd("ogrn", e.target.value)} /></div>
            <div className="space-y-1"><Label>ОКПО</Label><Input className="h-8" value={form.okpo} onChange={e => upd("okpo", e.target.value)} /></div>
            <div className="space-y-1 md:col-span-2"><Label>Юридический адрес</Label><Input className="h-8" value={form.legal_address} onChange={e => upd("legal_address", e.target.value)} /></div>
            <div className="space-y-1"><Label>Телефон</Label><Input className="h-8" value={form.phone} onChange={e => upd("phone", e.target.value)} /></div>
            <div className="space-y-1"><Label>Email</Label><Input className="h-8" value={form.email} onChange={e => upd("email", e.target.value)} /></div>
          </div>
        </div>

        <div>
          <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-2">Банковские реквизиты</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="space-y-1 md:col-span-2"><Label>Название банка</Label><Input className="h-8" value={form.bank_name} onChange={e => upd("bank_name", e.target.value)} /></div>
            <div className="space-y-1">
              <Label>БИК</Label>
              <div className="flex gap-1">
                <Input className="h-8" value={form.bank_bik} onChange={e => upd("bank_bik", e.target.value)} />
                <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Найти по БИК"
                  onClick={() => bikLookup.mutate()} disabled={bikLookup.isPending || !form.bank_bik}>
                  {bikLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1"><Label>Корр. счёт</Label><Input className="h-8" value={form.bank_corr_account} onChange={e => upd("bank_corr_account", e.target.value)} /></div>
            <div className="space-y-1 md:col-span-2"><Label>Расчётный счёт</Label><Input className="h-8" value={form.bank_account} onChange={e => upd("bank_account", e.target.value)} /></div>
          </div>
        </div>

        {form.id && (
          <div className="border-t pt-3">
            <BankAccountsEditor ownerType="organization" ownerId={form.id} />
          </div>
        )}

        <div>
          <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-2">Ответственные лица</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Руководитель</Label><Input className="h-8" value={form.director_name} onChange={e => upd("director_name", e.target.value)} placeholder="Иванов И.И." /></div>
            <div className="space-y-1"><Label>Главный бухгалтер</Label><Input className="h-8" value={form.accountant_name} onChange={e => upd("accountant_name", e.target.value)} placeholder="Петрова П.П." /></div>
          </div>
        </div>


        <div className="flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" /> Сохранить
          </Button>
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="refs" className="mt-3 space-y-2">
          <NumberingRef />
          <WarehousesRef />
          <ProductTypesRef />
          <PriceTypesRef />
          <MyPriceTypeRef />
          <DiscountsRef />
          <UnitsRef />
          <BanksRef />
          <CashflowItemsRef />
          <InvoiceStatusesRef />
        </TabsContent>

        <TabsContent value="kkt" className="mt-3 space-y-2">
          <KktSettingsPanel />
        </TabsContent>

        <TabsContent value="import" className="mt-3 space-y-4">
          <Import1CPanel />
          <PriceImportPanel />
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
      const { data, error } = await (db as any).from("units").select("id,short_name,full_name").eq("workspace_id", wsId).order("short_name");
      if (error) throw error;
      return data as Unit[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const s = short.trim();
      if (!s) throw new Error("Введите краткое название");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (db as any).from("units").insert({
        user_id: user.id, workspace_id: wsId, short_name: s, full_name: full.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["units"] }); setShort(""); setFull(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["units"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Единицы измерения</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 w-28"><Label className="text-xs">Краткое</Label><Input className="h-8" placeholder="шт" value={short} onChange={e => setShort(e.target.value)} /></div>
        <div className="space-y-1 flex-1"><Label className="text-xs">Полное</Label><Input className="h-8" placeholder="Штука" value={full} onChange={e => setFull(e.target.value)} /></div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {units.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока нет единиц</div>}
        {units.map(u => (
          <div key={u.id} className="flex items-center py-1 gap-2">
            <div className="w-28 font-medium">{u.short_name}</div>
            <div className="flex-1 text-muted-foreground">{u.full_name || "—"}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${u.short_name}"?`)) del.mutate(u.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
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
      const { data: { user } } = await db.auth.getUser();
      if (!user) return [];
      let { data } = await (db as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order");
      if (!data || data.length === 0) {
        const defaults = [
          { name: "Новый", color: "#64748b", sort_order: 0 },
          { name: "Предоплата", color: "#eab308", sort_order: 1 },
          { name: "Оплачен", color: "#3b82f6", sort_order: 2 },
          { name: "Выполнен", color: "#22c55e", sort_order: 3 },
        ].map(s => ({ ...s, user_id: user.id, workspace_id: wsId }));
        await (db as any).from("invoice_statuses").insert(defaults);
        ({ data } = await (db as any).from("invoice_statuses").select("id,name,color,sort_order").eq("workspace_id", wsId).order("sort_order"));
      }
      return (data ?? []) as InvStatus[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название статуса");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const maxOrder = statuses.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const { error } = await (db as any).from("invoice_statuses").insert({
        user_id: user.id, workspace_id: wsId, name: n, color, sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice_statuses"] }); setName(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upd = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<InvStatus> }) => {
      const { error } = await db.from("invoice_statuses").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice_statuses"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("invoice_statuses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice_statuses"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Статусы накладных</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 flex-1"><Label className="text-xs">Название</Label><Input className="h-8" placeholder="Новый" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-1 w-16"><Label className="text-xs">Цвет</Label><Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 p-0.5" /></div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {statuses.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока нет статусов</div>}
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
    <div className="flex items-center py-1 gap-2">
      <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-7 w-10 p-0.5" />
      <Input value={name} onChange={e => setName(e.target.value)} className="h-8 flex-1" />
      {dirty && (
        <Button size="sm" className="h-7" onClick={() => onSave({ name, color })}>
          <Save className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
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
    queryFn: async () => (await (db as any).from("organizations").select("id,invoice_number_mask,invoice_number_start,name").eq("workspace_id", wsId).order("is_primary", { ascending: false }).limit(1).maybeSingle()).data,
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
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const payload = { invoice_number_mask: mask, invoice_number_start: Math.max(1, Math.floor(Number(start) || 1)) };
      if (org && (org as any).id) {
        const { error } = await (db as any).from("organizations").update(payload).eq("id", (org as any).id);
        if (error) throw error;
      } else {
        const { error } = await (db as any).from("organizations").insert({ user_id: user.id, workspace_id: wsId, name: "Моя организация", is_primary: true, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-organization"] }); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Нумерация накладных</h2>
      <div className="flex gap-1 items-end max-w-2xl flex-wrap">
        <div className="space-y-1 flex-1 min-w-[240px]">
          <Label className="text-xs">Маска номера</Label>
          <Input className="h-8" value={mask} onChange={e => setMask(e.target.value)} placeholder="{YYYY}-{MM}-{DD}-{NNN}" />
        </div>
        <div className="space-y-1 w-40">
          <Label className="text-xs">Начинать с №</Label>
          <Input className="h-8" type="number" min={1} value={start} onChange={e => setStart(Number(e.target.value))} />
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" />Сохранить</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Подстановки: <code>{"{YYYY}"}</code>, <code>{"{YY}"}</code>, <code>{"{MM}"}</code>, <code>{"{DD}"}</code>, <code>{"{N}"}</code>, <code>{"{NN}"}</code>, <code>{"{NNN}"}</code>, <code>{"{NNNN}"}</code>
      </p>
    </Card>
  );
}

// ============ БАЗЫ ДАННЫХ ============
// Каждая "база данных" — это независимый набор данных: свои контрагенты,
// товары, накладные, справочники и организация. Пользователь может создавать
// несколько баз (например «Тестовая» и «Основная») и переключаться между ними.

type WS = { id: string; name: string; created_at: string };

function WorkspacesRef() {
  const qc = useQueryClient();
  const activeId = useActiveWorkspaceId();
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: list = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("workspaces")
        .select("id,name,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WS[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const n = newName.trim();
      if (!n) throw new Error("Введите название базы");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const { error } = await (db as any).from("workspaces").insert({ user_id: user.id, name: n });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); setNewName(""); toast.success("База создана"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async () => {
      const n = renameValue.trim();
      if (!n || !renameId) throw new Error("Введите название");
      const { error } = await (db as any).from("workspaces").update({ name: n }).eq("id", renameId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); setRenameId(null); setRenameValue(""); toast.success("Переименовано"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Удаление возможно только у ПУСТОЙ базы (без контрагентов, товаров,
  // накладных, единиц, статусов, папок и организаций).
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (id === activeId) throw new Error("Нельзя удалить активную базу. Сначала переключитесь на другую.");
      if (list.length <= 1) throw new Error("Нельзя удалить единственную базу");
      const tables = ["partners", "products", "product_folders", "invoices", "invoice_statuses", "units", "organizations"] as const;
      for (const t of tables) {
        const { count, error } = await (db as any)
          .from(t).select("id", { count: "exact", head: true }).eq("workspace_id", id);
        if (error) throw error;
        if ((count ?? 0) > 0) throw new Error("Нельзя удалить непустую базу. Сначала очистите её данные.");
      }
      const { error } = await (db as any).from("workspaces").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); toast.success("База удалена"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchTo = (id: string) => {
    if (id === activeId) return;
    activeWorkspace.set(id);
    qc.invalidateQueries();
  };

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Database className="h-3.5 w-3.5" /> Мои базы данных</h2>
      <p className="text-xs text-muted-foreground">У каждой базы свои контрагенты, товары, накладные и настройки.</p>

      <div className="border rounded-md divide-y">
        {list.length === 0 && (
          <div className="p-2 text-xs text-muted-foreground">Пока нет баз</div>
        )}
        {list.map((w) => {
          const isActive = w.id === activeId;
          const isRenaming = renameId === w.id;
          return (
            <div key={w.id} className="flex items-center gap-2 p-2">
              <button
                onClick={() => switchTo(w.id)}
                className={`h-6 w-6 rounded-full border flex items-center justify-center shrink-0 ${isActive ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
                title={isActive ? "Активная" : "Сделать активной"}
              >
                {isActive && <Check className="h-3.5 w-3.5" />}
              </button>
              {isRenaming ? (
                <>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-8 flex-1"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") rename.mutate(); if (e.key === "Escape") setRenameId(null); }}
                  />
                  <Button size="sm" className="h-7" onClick={() => rename.mutate()} disabled={rename.isPending}>OK</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setRenameId(null)}>Отмена</Button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {w.name}
                      {isActive && <span className="ml-2 text-xs text-primary">активная</span>}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setRenameId(w.id); setRenameValue(w.name); }} title="Переименовать">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => { if (confirm(`Удалить базу "${w.name}"?`)) remove.mutate(w.id); }}
                    title="Удалить"
                    disabled={isActive || list.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-1 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Новая база</Label>
          <Input
            className="h-8"
            placeholder="Например: Основная"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create.mutate(); }}
          />
        </div>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Создать
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Удалить можно только пустую базу — сначала очистите её данные. Активную базу нельзя удалить, переключитесь на другую.
      </p>

      <NegativeStockSetting wsId={activeId} />
      </Card>
  );
}

/** Разрешать ли продавать товар, которого нет на складе. */
function NegativeStockSetting({ wsId }: { wsId: string | null }) {
  const qc = useQueryClient();
  const { data: ws } = useQuery({
    queryKey: ["ws-settings", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("workspaces").select("id,allow_negative_stock").eq("id", wsId).maybeSingle()).data,
  });
  const allow = !!ws?.allow_negative_stock;
  const toggle = useMutation({
    mutationFn: async (v: boolean) => {
      const { error } = await (db as any).from("workspaces").update({ allow_negative_stock: v }).eq("id", wsId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws-settings", wsId] }); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="border-t pt-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium">Разрешить продажу в минус</div>
        <p className="text-xs text-muted-foreground">
          Если выключено, накладную не удастся провести, когда товара не хватает на складе.
        </p>
      </div>
      <Switch checked={allow} onCheckedChange={(v) => toggle.mutate(v)} disabled={!wsId || toggle.isPending} />
    </div>
  );
}
