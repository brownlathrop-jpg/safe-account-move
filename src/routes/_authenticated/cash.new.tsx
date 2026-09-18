import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/cash/new")({
  head: () => ({ meta: [{ title: "Новый кассовый документ — КабинетCRM" }] }),
  component: NewCashDoc,
});

function NewCashDoc() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();

  const [kind, setKind] = useState<"incoming" | "outgoing">("incoming");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [partnerId, setPartnerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");

  const { data: partners = [] } = useQuery({
    queryKey: ["partners", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("partners").select("id,name,kind").eq("workspace_id", wsId).order("name")).data ?? [],
  });
  const { data: cashItems = [] } = useQuery({
    queryKey: ["cashflow_items", wsId],
    enabled: !!wsId,
    queryFn: async () => (await (db as any).from("cashflow_items").select("id,name").eq("workspace_id", wsId).order("name")).data ?? [],
  });
  const { data: cnt = 0 } = useQuery({
    queryKey: ["cash-count", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { count } = await (db as any).from("invoices").select("id", { count: "exact", head: true }).eq("workspace_id", wsId).eq("doc_type", "cash_receipt");
      return count ?? 0;
    },
  });

  const autoNumber = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const prefix = kind === "incoming" ? "ПКО" : "РКО";
    return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(cnt + 1).padStart(3, "0")}`;
  }, [cnt, kind]);

  const effectiveNumber = number || autoNumber;

  const save = useMutation({
    mutationFn: async () => {
      if (!wsId) throw new Error("Не выбрана база данных");
      if (!(amount > 0)) throw new Error("Укажите сумму больше нуля");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");

      const payload: Record<string, unknown> = {
        user_id: user.id,
        workspace_id: wsId,
        number: effectiveNumber,
        kind,
        partner_id: partnerId || null,
        issue_date: date,
        status: "draft",
        doc_type: "cash_receipt",
        cash_received: amount,
        cash_basis: basis || null,
        note: note || null,
      };
      if (itemId) payload.cashflow_item_id = itemId;

      const { data, error } = await (db as any).from("invoices").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["cash-count"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(kind === "incoming" ? "ПКО создан" : "РКО создан");
      navigate({ to: "/invoices/$id", params: { id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Новый кассовый документ</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/cash" })}>Отменить</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Тип</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="incoming">Приход (ПКО)</SelectItem>
                <SelectItem value="outgoing">Расход (РКО)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Номер</Label>
            <Input className="h-8" value={effectiveNumber} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Дата</Label>
            <Input className="h-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Контрагент</Label>
            <Select value={partnerId || undefined} onValueChange={setPartnerId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                {(partners as any[]).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Статья движения денег</Label>
            <Select value={itemId || undefined} onValueChange={setItemId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Не выбрана" /></SelectTrigger>
              <SelectContent>
                {(cashItems as any[]).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Сумма</Label>
            <NumCell className="h-8" step="0.01" value={amount} onCommit={setAmount} />
          </div>
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <div>
          <Label className="text-xs">Основание</Label>
          <Input className="h-8" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Оплата по счёту № …" />
        </div>
        <div>
          <Label className="text-xs">Комментарий</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
      </Card>
    </div>
  );
}
