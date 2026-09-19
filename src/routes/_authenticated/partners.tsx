import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { db } from "@/integrations/db";
import { lookupOrgByInn } from "@/lib/dadata.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Loader2, Download, Printer } from "lucide-react";
import { BankAccountsEditor } from "@/components/bank-accounts-editor";
import { downloadCsv, type CsvColumn } from "@/lib/export-csv";
import { printList } from "@/lib/print-list";
import { usePrintBrand } from "@/hooks/use-print-brand";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "Контрагенты — КабинетCRM" }] }),
  component: PartnersPage,
});

type PartnerKind = "customer" | "supplier" | "employee" | "other";
const KIND_LABELS: Record<PartnerKind, string> = { customer: "Покупатель", supplier: "Поставщик", employee: "Сотрудник", other: "Прочее" };
type Partner = {
  id: string;
  kind: PartnerKind;
  name: string;
  full_name: string | null;
  inn: string | null;
  kpp: string | null;
  okpo: string | null;
  entity_type: "legal" | "individual" | "entrepreneur" | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  comment: string | null;
};

function PartnersPage() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const brand = usePrintBrand();
  const [editing, setEditing] = useState<Partial<Partner> | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | PartnerKind>("customer");
  const lookupOrg = useServerFn(lookupOrgByInn);
  const innLookup = useMutation({
    mutationFn: (inn: string) => lookupOrg({ data: { inn } }),
    onSuccess: (res) => {
      if (!res) { toast.error("Организация не найдена"); return; }
      setEditing((prev) => prev ? {
        ...prev,
        name: res.name || prev.name,
        full_name: (res as any).full_name || prev.full_name || null,
        inn: res.inn,
        kpp: (res as any).kpp || prev.kpp || null,
        okpo: (res as any).okpo || prev.okpo || null,
        address: res.legal_address || prev.address,
      } : prev);
      toast.success("Данные контрагента загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-list", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any).from("partners").select("*").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return data as Partner[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (p: Partial<Partner>) => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const payload = {
        user_id: user.id,
        workspace_id: wsId,
        kind: p.kind || "customer",
        name: p.name!,
        full_name: p.full_name || null,
        inn: p.inn || null,
        kpp: p.kpp || null,
        okpo: p.okpo || null,
        entity_type: p.entity_type || null,
        phone: p.phone || null,
        email: p.email || null,
        address: p.address || null,
        comment: p.comment || null,
      };
      if (p.id) {
        const { error } = await (db as any).from("partners").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await (db as any).from("partners").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners-list"] }); qc.invalidateQueries({ queryKey: ["partners"] }); setOpen(false); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("partners").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners-list"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter(p => {
      if (kindFilter !== "all" && p.kind !== kindFilter) return false;
      if (!q) return true;
      return [p.name, p.full_name, p.inn, p.phone, p.email, p.address]
        .some(v => String(v ?? "").toLowerCase().includes(q));
    });
  }, [partners, search, kindFilter]);

  const counts = useMemo(() => ({
    all: partners.length,
    customer: partners.filter(p => p.kind === "customer").length,
    supplier: partners.filter(p => p.kind === "supplier").length,
    employee: partners.filter(p => p.kind === "employee").length,
    other: partners.filter(p => p.kind === "other").length,
  }), [partners]);

  const listColumns: CsvColumn<Partner>[] = [
    { header: "Название", value: p => p.name },
    { header: "Полное наименование", value: p => p.full_name },
    { header: "Тип", value: p => KIND_LABELS[p.kind] },
    { header: "ИНН", value: p => p.inn },
    { header: "КПП", value: p => p.kpp },
    { header: "Телефон", value: p => p.phone },
    { header: "Email", value: p => p.email },
    { header: "Адрес", value: p => p.address },
    { header: "Комментарий", value: p => p.comment },
  ];
  const exportCsv = () => downloadCsv("контрагенты", filtered, listColumns);
  const printPartners = () => printList("Контрагенты", filtered, listColumns, brand);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Контрагенты</h1>
          <p className="text-sm text-muted-foreground">Клиенты и поставщики</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length} title="Выгрузить в Excel">
            <Download className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button variant="outline" onClick={printPartners} disabled={!filtered.length} title="Печать списка / сохранить в PDF">
            <Printer className="h-4 w-4 mr-1" /> Печать
          </Button>
          <Button onClick={() => { setEditing({ kind: kindFilter === "all" ? "customer" : kindFilter, name: "" }); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Добавить
          </Button>
        </div>
      </div>

      <Tabs value={kindFilter} onValueChange={(v) => setKindFilter(v as any)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="customer">Покупатели ({counts.customer})</TabsTrigger>
          <TabsTrigger value="supplier">Поставщики ({counts.supplier})</TabsTrigger>
          <TabsTrigger value="employee">Сотрудники ({counts.employee})</TabsTrigger>
          <TabsTrigger value="other">Прочее ({counts.other})</TabsTrigger>
          <TabsTrigger value="all">Все ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Поиск: название, ИНН, телефон, адрес" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">Найдено: {filtered.length}</span>
      </div>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 py-1">Название</TableHead>
              {kindFilter === "all" && <TableHead className="h-8 py-1">Тип</TableHead>}
              <TableHead className="h-8 py-1">ИНН</TableHead>
              <TableHead className="h-8 py-1">Телефон</TableHead>
              <TableHead className="h-8 py-1">Email</TableHead>
              <TableHead className="h-8 w-[76px] py-1"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Ничего не найдено</TableCell></TableRow>}
            {filtered.map(p => (
              <TableRow key={p.id} className="h-9">
                <TableCell className="py-1 font-medium">
                  <Link to="/partner/$id" params={{ id: p.id }} className="text-primary hover:underline">{p.name}</Link>
                </TableCell>
                {kindFilter === "all" && (
                  <TableCell className="py-1"><Badge variant={p.kind === "customer" ? "default" : p.kind === "employee" ? "outline" : p.kind === "other" ? "ghost" : "secondary"}>{KIND_LABELS[p.kind]}</Badge></TableCell>
                )}
                <TableCell className="py-1">{p.inn || "—"}</TableCell>
                <TableCell className="py-1">{p.phone || "—"}</TableCell>
                <TableCell className="py-1">{p.email || "—"}</TableCell>
                <TableCell className="py-1">
                  <div className="flex flex-nowrap items-center justify-end gap-0.5">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Удалить "${p.name}"?`)) remove.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Редактировать" : "Новый контрагент"}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(editing); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Тип</Label>
                  <Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Покупатель</SelectItem>
                      <SelectItem value="supplier">Поставщик</SelectItem>
                      <SelectItem value="employee">Сотрудник</SelectItem>
                      <SelectItem value="other">Прочее</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Юр/физ лицо</Label>
                  <Select value={editing.entity_type ?? "legal"} onValueChange={(v) => setEditing({ ...editing, entity_type: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="legal">Юр. лицо</SelectItem>
                      <SelectItem value="entrepreneur">ИП</SelectItem>
                      <SelectItem value="individual">Физ. лицо</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Краткое название *</Label>
                <Input required value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Полное наименование</Label>
                <Input value={editing.full_name ?? ""} onChange={e => setEditing({ ...editing, full_name: e.target.value })} placeholder='Общество с ограниченной ответственностью "Ромашка"' />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>ИНН</Label>
                  <div className="flex gap-2">
                    <Input value={editing.inn ?? ""} onChange={e => setEditing({ ...editing, inn: e.target.value })} />
                    <Button type="button" variant="outline" size="icon" disabled={innLookup.isPending || !editing.inn} onClick={() => innLookup.mutate(editing.inn!)} title="Найти по ИНН">
                      {innLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2"><Label>КПП</Label><Input value={editing.kpp ?? ""} onChange={e => setEditing({ ...editing, kpp: e.target.value })} /></div>
                <div className="space-y-2"><Label>ОКПО</Label><Input value={editing.okpo ?? ""} onChange={e => setEditing({ ...editing, okpo: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Телефон</Label><Input value={editing.phone ?? ""} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={editing.email ?? ""} onChange={e => setEditing({ ...editing, email: e.target.value })} /></div>
              </div>
              <div className="space-y-2">
                <Label>Адрес</Label>
                <Input value={editing.address ?? ""} onChange={e => setEditing({ ...editing, address: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Комментарий</Label>
                <Input value={editing.comment ?? ""} onChange={e => setEditing({ ...editing, comment: e.target.value })} />
              </div>
              {editing.id && (
                <div className="border-t pt-4">
                  <BankAccountsEditor ownerType="partner" ownerId={editing.id} />
                </div>
              )}
              {!editing.id && (
                <div className="text-xs text-muted-foreground border-t pt-3">
                  Банковские счета можно будет добавить после сохранения карточки.
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
                <Button type="submit">Сохранить</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
