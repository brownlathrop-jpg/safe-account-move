import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Wallet } from "lucide-react";
import { db } from "@/integrations/db";

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

export type Payment = {
  id: string;
  invoice_id: string | null;
  partner_id: string | null;
  direction: "in" | "out";
  amount: number;
  date: string;
  method: "cash" | "bank";
  cashflow_item_id: string | null;
  note: string | null;
};

/** Оплаты по документу: сколько получено/уплачено и сколько осталось. */
export function PaymentsCard({
  invoiceId,
  partnerId,
  workspaceId,
  userId,
  total,
  direction,
}: {
  invoiceId: string;
  partnerId: string | null;
  workspaceId: string | null;
  userId: string | null;
  total: number;
  /** in — деньги получаем (продажа), out — платим поставщику. */
  direction: "in" | "out";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ amount: string; date: string; method: "cash" | "bank"; cashflow_item_id: string; note: string }>({
    amount: "",
    date: today(),
    method: "cash",
    cashflow_item_id: "",
    note: "",
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["invoice_payments", invoiceId],
    queryFn: async () => {
      const { data, error } = await db
        .from("invoice_payments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Payment[];
    },
  });

  const { data: cashflowItems = [] } = useQuery({
    queryKey: ["cashflow_items", workspaceId],
    queryFn: async () => {
      const { data, error } = await db.from("cashflow_items").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
  });

  const paid = useMemo(() => payments.reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const left = Math.max(0, Number(total || 0) - paid);

  const addPayment = useMutation({
    mutationFn: async () => {
      const amount = Number(String(form.amount).replace(",", "."));
      if (!amount || amount <= 0) throw new Error("Укажите сумму больше нуля");
      const { error } = await db.from("invoice_payments").insert({
        invoice_id: invoiceId,
        partner_id: partnerId,
        direction,
        amount,
        date: form.date || today(),
        method: form.method,
        cashflow_item_id: form.cashflow_item_id || null,
        note: form.note || null,
        workspace_id: workspaceId,
        user_id: userId,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice_payments"] });
      qc.invalidateQueries({ queryKey: ["partner-balance"] });
      toast.success("Оплата добавлена");
      setOpen(false);
      setForm({ amount: "", date: today(), method: "cash", cashflow_item_id: "", note: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("invoice_payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice_payments"] });
      qc.invalidateQueries({ queryKey: ["partner-balance"] });
      toast.success("Оплата удалена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5 print:hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" /> Оплаты
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setForm(f => ({ ...f, amount: left > 0 ? String(left) : "" }));
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Добавить оплату
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
        <span>Сумма документа: <b>{fmt.format(Number(total || 0))}</b></span>
        <span>{direction === "in" ? "Получено" : "Уплачено"}: <b className="text-emerald-600">{fmt.format(paid)}</b></span>
        <span>
          Осталось:{" "}
          <b className={left > 0 ? "text-destructive" : "text-emerald-600"}>{fmt.format(left)}</b>
        </span>
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Оплат пока нет.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Способ</TableHead>
              <TableHead>Статья</TableHead>
              <TableHead>Примечание</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.date ? dfmt.format(new Date(p.date)) : "—"}</TableCell>
                <TableCell>{p.method === "bank" ? "Банк" : "Наличные"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {cashflowItems.find(c => c.id === p.cashflow_item_id)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.note || "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmt.format(Number(p.amount || 0))}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => { if (confirm("Удалить оплату?")) removePayment.mutate(p.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Добавить оплату</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Сумма</Label>
              <Input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Дата</Label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Способ</Label>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as "cash" | "bank" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Наличные</SelectItem>
                  <SelectItem value="bank">Банк</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Статья движения денег</Label>
              <Select value={form.cashflow_item_id || "none"} onValueChange={(v) => setForm({ ...form, cashflow_item_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Не указана" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Не указана</SelectItem>
                  {cashflowItems.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Примечание</Label>
              <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={() => addPayment.mutate()} disabled={addPayment.isPending}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
