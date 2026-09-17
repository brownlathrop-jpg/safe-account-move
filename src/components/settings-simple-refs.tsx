import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { lookupBankByBik } from "@/lib/dadata.functions";

async function getUserOrThrow() {
  const { data: { user } } = await db.auth.getUser();
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
      const { data, error } = await (db as any).from("warehouses")
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
      const { error } = await (db as any).from("warehouses").insert({
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
      await (db as any).from("warehouses").update({ is_default: false }).eq("workspace_id", wsId);
      await (db as any).from("warehouses").update({ is_default: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouses"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Склады</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 w-52"><Label className="text-xs">Название</Label><Input className="h-8" placeholder="Основной склад" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-1 flex-1"><Label className="text-xs">Адрес</Label><Input className="h-8" value={address} onChange={e => setAddress(e.target.value)} /></div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока нет складов</div>}
        {items.map(w => (
          <div key={w.id} className="flex items-center py-1 gap-2">
            <div className="w-52 font-medium flex items-center gap-1.5">
              {w.name}
              {w.is_default && <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">осн.</span>}
            </div>
            <div className="flex-1 text-muted-foreground truncate">{w.address || "—"}</div>
            {!w.is_default && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDefault.mutate(w.id)}>Сделать осн.</Button>}
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${w.name}"?`)) del.mutate(w.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
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
      const { data, error } = await (db as any).from("banks")
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
      const { error } = await (db as any).from("banks").insert({
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
      const { error } = await (db as any).from("banks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["banks"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Банки</h2>
      <form className="grid grid-cols-1 md:grid-cols-12 gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-1 md:col-span-3">
            <Label className="text-xs">БИК</Label>
            <div className="flex gap-1">
              <Input className="h-8" value={bik} onChange={e => setBik(e.target.value)} maxLength={9} />
              <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Найти по БИК"
                onClick={() => lookup.mutate()} disabled={lookup.isPending || !/^\d{9}$/.test(bik.trim())}>
                {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1 md:col-span-5"><Label className="text-xs">Название</Label><Input className="h-8" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-4"><Label className="text-xs">Корр. счёт</Label><Input className="h-8" value={corr} onChange={e => setCorr(e.target.value)} /></div>
          <div className="space-y-1 md:col-span-4"><Label className="text-xs">Город</Label><Input className="h-8" value={city} onChange={e => setCity(e.target.value)} /></div>
          <div className="md:col-span-8 flex justify-end">
            <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4 mr-1" />Добавить</Button>
          </div>
      </form>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока нет банков</div>}
        {items.map(b => (
          <div key={b.id} className="flex items-center py-1 gap-2">
            <div className="w-20 font-mono text-xs">{b.bik}</div>
            <div className="flex-1 font-medium truncate">{b.name}{b.city && <span className="text-muted-foreground font-normal"> · {b.city}</span>}</div>
            <div className="w-56 text-xs text-muted-foreground font-mono truncate">{b.corr_account || "—"}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить банк "${b.name}"?`)) del.mutate(b.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
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
      const { data, error } = await (db as any).from("product_types")
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
      const { error } = await (db as any).from("product_types").insert({
        user_id: user.id, workspace_id: wsId, name: n, is_service: isService,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product_types"] }); setName(""); setIsService(false); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).from("product_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product_types"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Виды номенклатуры</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 flex-1"><Label className="text-xs">Название</Label><Input className="h-8" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-1 w-36">
          <Label className="text-xs">Тип</Label>
          <Select value={isService ? "service" : "product"} onValueChange={v => setIsService(v === "service")}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Товар</SelectItem>
              <SelectItem value="service">Услуга</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока пусто</div>}
        {items.map(t => (
          <div key={t.id} className="flex items-center py-1 gap-2">
            <div className="flex-1 font-medium">{t.name}</div>
            <div className="text-muted-foreground w-28">{t.is_service ? "Услуга" : "Товар"}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${t.name}"?`)) del.mutate(t.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
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
      const { data, error } = await (db as any).from("price_types")
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
      const { error } = await (db as any).from("price_types").insert({
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
      await (db as any).from("price_types").update({ is_default: false }).eq("workspace_id", wsId);
      await (db as any).from("price_types").update({ is_default: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["price_types"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).from("price_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["price_types"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Типы цен</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 flex-1"><Label className="text-xs">Название</Label><Input className="h-8" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-1 w-24"><Label className="text-xs">Валюта</Label><Input className="h-8" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} /></div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока нет типов цен</div>}
        {items.map(p => (
          <div key={p.id} className="flex items-center py-1 gap-2">
            <div className="flex-1 font-medium flex items-center gap-1.5">
              {p.name}
              {p.is_default && <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">осн.</span>}
            </div>
            <div className="w-12 text-muted-foreground">{p.currency}</div>
            {!p.is_default && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDefault.mutate(p.id)}>Сделать осн.</Button>}
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${p.name}"?`)) del.mutate(p.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
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
      const { data, error } = await (db as any).from("cashflow_items")
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
      const { error } = await (db as any).from("cashflow_items").insert({
        user_id: user.id, workspace_id: wsId, name: n, direction,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cashflow_items"] }); setName(""); toast.success("Добавлено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).from("cashflow_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cashflow_items"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const label = (d: string) => d === "in" ? "Поступление" : d === "out" ? "Расход" : "Оба";

  return (
    <Card className="p-3 space-y-2 text-sm">
      <h2 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Статьи движения денег</h2>
      <form className="flex gap-1 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <div className="space-y-1 flex-1"><Label className="text-xs">Название</Label><Input className="h-8" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="space-y-1 w-40">
          <Label className="text-xs">Направление</Label>
          <Select value={direction} onValueChange={v => setDirection(v as any)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="in">Поступление</SelectItem>
              <SelectItem value="out">Расход</SelectItem>
              <SelectItem value="both">Оба</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
      </form>
      <div className="divide-y border-t">
        {items.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Пока пусто</div>}
        {items.map(c => (
          <div key={c.id} className="flex items-center py-1 gap-2">
            <div className="flex-1 font-medium">{c.name}</div>
            <div className="w-28 text-muted-foreground">{label(c.direction)}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${c.name}"?`)) del.mutate(c.id); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}