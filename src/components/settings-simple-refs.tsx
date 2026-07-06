import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { lookupBankByBik } from "@/lib/dadata.functions";

async function getUserOrThrow() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Нет сессии");
  return user;
}

// ============================================================
// Склады
// ============================================================
type Warehouse = { id: string; name: string; address: string | null; is_default: boolean };

export function WarehousesRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["warehouses", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("warehouses")
        .select("id,name,address,is_default").eq("workspace_id", wsId)
        .order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return data as Warehouse[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название склада");
      const user = await getUserOrThrow();
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("warehouses").insert({
        user_id: user.id, workspace_id: wsId, name: n, address: address.trim() || null,
        is_default: items.length === 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses"] }); setName(""); setAddress(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      if (!wsId) return;
      await (supabase as any).from("warehouses").update({ is_default: false }).eq("workspace_id", wsId);
      await (supabase as any).from("warehouses").update({ is_default: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Склады</h2>
        <p className="text-sm text-muted-foreground mb-4">Места хранения товара. Один можно назначить основным.</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 w-56"><Label>Название</Label><Input placeholder="Основной склад" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2 flex-1"><Label>Адрес (необязательно)</Label><Input value={address} onChange={e => setAddress(e.target.value)} /></div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока нет складов</div>}
        {items.map(w => (
          <div key={w.id} className="flex items-center py-2 gap-3">
            <div className="w-56 font-medium flex items-center gap-2">
              {w.name}
              {w.is_default && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">основной</span>}
            </div>
            <div className="flex-1 text-sm text-muted-foreground">{w.address || "—"}</div>
            {!w.is_default && <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(w.id)}>Сделать основным</Button>}
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${w.name}"?`)) del.mutate(w.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// Банки
// ============================================================
type Bank = { id: string; bik: string; name: string; corr_account: string | null; city: string | null };

export function BanksRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [bik, setBik] = useState("");
  const [name, setName] = useState("");
  const [corr, setCorr] = useState("");
  const [city, setCity] = useState("");
  const bikFn = useServerFn(lookupBankByBik);

  const { data: items = [] } = useQuery({
    queryKey: ["banks", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("banks")
        .select("id,bik,name,corr_account,city").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return data as Bank[];
    },
  });

  const lookup = useMutation({
    mutationFn: () => bikFn({ data: { bik: bik.trim() } }),
    onSuccess: (r) => {
      if (!r) { toast.error("Банк не найден"); return; }
      setName(r.bank_name || "");
      setCorr(r.bank_corr_account || "");
      toast.success("Реквизиты загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const add = useMutation({
    mutationFn: async () => {
      const b = bik.trim();
      const n = name.trim();
      if (!/^\d{9}$/.test(b)) throw new Error("БИК должен содержать 9 цифр");
      if (!n) throw new Error("Введите название банка");
      const user = await getUserOrThrow();
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("banks").insert({
        user_id: user.id, workspace_id: wsId, bik: b, name: n,
        corr_account: corr.trim() || null, city: city.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["banks"] });
      setBik(""); setName(""); setCorr(""); setCity("");
      toast.success("Добавлено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("banks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["banks"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Банки</h2>
        <p className="text-sm text-muted-foreground mb-4">Справочник банков. Введите БИК и нажмите поиск — реквизиты подставятся автоматически.</p>
        <form className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 md:col-span-3">
            <Label>БИК</Label>
            <div className="flex gap-2">
              <Input value={bik} onChange={e => setBik(e.target.value)} maxLength={9} />
              <Button type="button" size="icon" variant="outline" title="Найти по БИК"
                onClick={() => lookup.mutate()} disabled={lookup.isPending || !/^\d{9}$/.test(bik.trim())}>
                {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2 md:col-span-5"><Label>Название</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2 md:col-span-4"><Label>Корр. счёт</Label><Input value={corr} onChange={e => setCorr(e.target.value)} /></div>
          <div className="space-y-2 md:col-span-4"><Label>Город (необязательно)</Label><Input value={city} onChange={e => setCity(e.target.value)} /></div>
          <div className="md:col-span-8 flex justify-end">
            <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
          </div>
        </form>
      </div>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока нет банков</div>}
        {items.map(b => (
          <div key={b.id} className="flex items-center py-2 gap-3">
            <div className="w-24 font-mono text-sm">{b.bik}</div>
            <div className="flex-1 font-medium">{b.name}{b.city && <span className="text-muted-foreground font-normal"> · {b.city}</span>}</div>
            <div className="w-64 text-xs text-muted-foreground font-mono truncate">{b.corr_account || "—"}</div>
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить банк "${b.name}"?`)) del.mutate(b.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// Виды номенклатуры
// ============================================================
type ProductType = { id: string; name: string; is_service: boolean };

export function ProductTypesRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [name, setName] = useState("");
  const [isService, setIsService] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["product_types", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("product_types")
        .select("id,name,is_service").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return data as ProductType[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название");
      const user = await getUserOrThrow();
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("product_types").insert({
        user_id: user.id, workspace_id: wsId, name: n, is_service: isService,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product_types"] }); setName(""); setIsService(false); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("product_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product_types"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Виды номенклатуры</h2>
        <p className="text-sm text-muted-foreground mb-4">Классификация товаров и услуг (Товары, Услуги, Материалы…).</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 flex-1"><Label>Название</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2 w-40">
            <Label>Тип</Label>
            <Select value={isService ? "service" : "product"} onValueChange={v => setIsService(v === "service")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Товар</SelectItem>
                <SelectItem value="service">Услуга</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока пусто</div>}
        {items.map(t => (
          <div key={t.id} className="flex items-center py-2 gap-3">
            <div className="flex-1 font-medium">{t.name}</div>
            <div className="text-sm text-muted-foreground w-32">{t.is_service ? "Услуга" : "Товар"}</div>
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${t.name}"?`)) del.mutate(t.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// Типы цен
// ============================================================
type PriceType = { id: string; name: string; currency: string; is_default: boolean };

export function PriceTypesRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("RUB");

  const { data: items = [] } = useQuery({
    queryKey: ["price_types", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("price_types")
        .select("id,name,currency,is_default").eq("workspace_id", wsId)
        .order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return data as PriceType[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название");
      const user = await getUserOrThrow();
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("price_types").insert({
        user_id: user.id, workspace_id: wsId, name: n, currency, is_default: items.length === 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["price_types"] }); setName(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      if (!wsId) return;
      await (supabase as any).from("price_types").update({ is_default: false }).eq("workspace_id", wsId);
      await (supabase as any).from("price_types").update({ is_default: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["price_types"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("price_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["price_types"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Типы цен</h2>
        <p className="text-sm text-muted-foreground mb-4">Например «Розничная», «Оптовая», «Партнёрская».</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 flex-1"><Label>Название</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2 w-32"><Label>Валюта</Label><Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} /></div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока нет типов цен</div>}
        {items.map(p => (
          <div key={p.id} className="flex items-center py-2 gap-3">
            <div className="flex-1 font-medium flex items-center gap-2">
              {p.name}
              {p.is_default && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">основной</span>}
            </div>
            <div className="w-16 text-sm text-muted-foreground">{p.currency}</div>
            {!p.is_default && <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(p.id)}>Сделать основным</Button>}
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${p.name}"?`)) del.mutate(p.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// Статьи движения денежных средств
// ============================================================
type CashflowItem = { id: string; name: string; direction: "in" | "out" | "both" };

export function CashflowItemsRef() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"in" | "out" | "both">("both");

  const { data: items = [] } = useQuery({
    queryKey: ["cashflow_items", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cashflow_items")
        .select("id,name,direction").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return data as CashflowItem[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Введите название");
      const user = await getUserOrThrow();
      if (!wsId) throw new Error("Не выбрана база данных");
      const { error } = await (supabase as any).from("cashflow_items").insert({
        user_id: user.id, workspace_id: wsId, name: n, direction,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cashflow_items"] }); setName(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("cashflow_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cashflow_items"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const label = (d: string) => d === "in" ? "Поступление" : d === "out" ? "Расход" : "Оба";

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="font-medium mb-1">Статьи движения денег</h2>
        <p className="text-sm text-muted-foreground mb-4">Используются в кассе и банке для классификации операций.</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-2 flex-1"><Label>Название</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-2 w-44">
            <Label>Направление</Label>
            <Select value={direction} onValueChange={v => setDirection(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Поступление</SelectItem>
                <SelectItem value="out">Расход</SelectItem>
                <SelectItem value="both">Оба</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
        </form>
      </div>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Пока пусто</div>}
        {items.map(c => (
          <div key={c.id} className="flex items-center py-2 gap-3">
            <div className="flex-1 font-medium">{c.name}</div>
            <div className="w-32 text-sm text-muted-foreground">{label(c.direction)}</div>
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${c.name}"?`)) del.mutate(c.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}