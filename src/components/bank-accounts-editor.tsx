import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace";

type Bank = { id: string; bik: string; name: string };
type Account = {
  id: string;
  bank_id: string | null;
  account_number: string;
  currency: string;
  is_primary: boolean;
};

type Props = {
  ownerType: "partner" | "organization";
  ownerId: string;
};

/**
 * Управление банковскими счетами контрагента или организации.
 * Требует, чтобы у владельца уже был id (карточка сохранена).
 */
export function BankAccountsEditor({ ownerType, ownerId }: Props) {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const ownerCol = ownerType === "partner" ? "partner_id" : "organization_id";
  const key = ["bank_accounts", ownerType, ownerId];

  const [bankId, setBankId] = useState<string>("");
  const [num, setNum] = useState("");
  const [currency, setCurrency] = useState("RUB");

  const { data: banks = [] } = useQuery({
    queryKey: ["banks", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any).from("banks")
        .select("id,bik,name").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return data as Bank[];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: key,
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (db as any).from("bank_accounts")
        .select("id,bank_id,account_number,currency,is_primary")
        .eq(ownerCol, ownerId)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return data as Account[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = num.trim();
      if (!bankId) throw new Error("Выберите банк");
      if (!/^\d{20}$/.test(n)) throw new Error("Расчётный счёт — 20 цифр");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      const payload: any = {
        user_id: user.id, workspace_id: wsId,
        owner_type: ownerType,
        [ownerCol]: ownerId,
        bank_id: bankId,
        account_number: n,
        currency: currency.toUpperCase() || "RUB",
        is_primary: accounts.length === 0,
      };
      const { error } = await (db as any).from("bank_accounts").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setBankId(""); setNum(""); setCurrency("RUB");
      toast.success("Счёт добавлен");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setPrimary = useMutation({
    mutationFn: async (id: string) => {
      await (db as any).from("bank_accounts").update({ is_primary: false }).eq(ownerCol, ownerId);
      await (db as any).from("bank_accounts").update({ is_primary: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).from("bank_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Счёт удалён"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bankName = (id: string | null) => {
    const b = banks.find(x => x.id === id);
    return b ? `${b.name} (${b.bik})` : "—";
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Банковские счета</div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="space-y-1 md:col-span-5">
          <Label className="text-xs">Банк</Label>
          <Select value={bankId} onValueChange={setBankId}>
            <SelectTrigger><SelectValue placeholder={banks.length === 0 ? "Сначала добавьте банк в Настройках" : "Выберите банк"} /></SelectTrigger>
            <SelectContent>
              {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.bik})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 md:col-span-5">
          <Label className="text-xs">Расчётный счёт (20 цифр)</Label>
          <Input value={num} onChange={e => setNum(e.target.value)} maxLength={20} />
        </div>
        <div className="space-y-1 md:col-span-1">
          <Label className="text-xs">Валюта</Label>
          <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </div>
        <div className="md:col-span-1">
          <Button type="button" size="icon" onClick={() => add.mutate()} disabled={add.isPending} title="Добавить">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="divide-y border rounded-md">
        {accounts.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">Счетов пока нет</div>}
        {accounts.map(a => (
          <div key={a.id} className="flex items-center gap-3 p-2">
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                {bankName(a.bank_id)}
                {a.is_primary && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">основной</span>}
              </div>
              <div className="text-xs text-muted-foreground font-mono">{a.account_number} · {a.currency}</div>
            </div>
            {!a.is_primary && <Button type="button" size="sm" variant="ghost" onClick={() => setPrimary.mutate(a.id)}>Сделать основным</Button>}
            <Button type="button" size="icon" variant="ghost" onClick={() => { if (confirm("Удалить счёт?")) del.mutate(a.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}