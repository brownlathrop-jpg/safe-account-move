import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lookupOrgByInn } from "@/lib/dadata.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "Контрагенты — КабинетCRM" }] }),
  component: PartnersPage,
});

type Partner = { id: string; kind: "customer" | "supplier"; name: string; inn: string | null; phone: string | null; email: string | null; address: string | null; };

function PartnersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Partner> | null>(null);
  const [open, setOpen] = useState(false);
  const lookupOrg = useServerFn(lookupOrgByInn);
  const innLookup = useMutation({
    mutationFn: (inn: string) => lookupOrg({ data: { inn } }),
    onSuccess: (res) => {
      if (!res) { toast.error("Организация не найдена"); return; }
      setEditing((prev) => prev ? { ...prev, name: res.name || prev.name, inn: res.inn, address: res.legal_address || prev.address } : prev);
      toast.success("Данные контрагента загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("partners").select("*").order("name");
      if (error) throw error;
      return data as Partner[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (p: Partial<Partner>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const payload = {
        user_id: user.id,
        kind: p.kind || "customer",
        name: p.name!,
        inn: p.inn || null, phone: p.phone || null,
        email: p.email || null, address: p.address || null,
      };
      if (p.id) {
        const { error } = await supabase.from("partners").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("partners").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners-list"] }); qc.invalidateQueries({ queryKey: ["partners"] }); setOpen(false); toast.success("Сохранено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("partners").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners-list"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Контрагенты</h1>
          <p className="text-sm text-muted-foreground">Клиенты и поставщики</p>
        </div>
        <Button onClick={() => { setEditing({ kind: "customer", name: "" }); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Добавить
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>ИНН</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Контрагентов пока нет</TableCell></TableRow>}
            {partners.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell><Badge variant={p.kind === "customer" ? "default" : "secondary"}>{p.kind === "customer" ? "Клиент" : "Поставщик"}</Badge></TableCell>
                <TableCell>{p.inn || "—"}</TableCell>
                <TableCell>{p.phone || "—"}</TableCell>
                <TableCell>{p.email || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${p.name}"?`)) remove.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Редактировать" : "Новый контрагент"}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(editing); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Тип</Label>
                  <Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Клиент</SelectItem>
                      <SelectItem value="supplier">Поставщик</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>ИНН</Label>
                  <div className="flex gap-2">
                    <Input value={editing.inn ?? ""} onChange={e => setEditing({ ...editing, inn: e.target.value })} />
                    <Button type="button" variant="outline" size="icon" disabled={innLookup.isPending || !editing.inn} onClick={() => innLookup.mutate(editing.inn!)} title="Найти по ИНН">
                      {innLookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input required value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Телефон</Label><Input value={editing.phone ?? ""} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={editing.email ?? ""} onChange={e => setEditing({ ...editing, email: e.target.value })} /></div>
              </div>
              <div className="space-y-2">
                <Label>Адрес</Label>
                <Input value={editing.address ?? ""} onChange={e => setEditing({ ...editing, address: e.target.value })} />
              </div>
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
