// Настройки онлайн-кассы АТОЛ: адрес драйвера, налоги, кассир, проверка связи.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Plug } from "lucide-react";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { useKktCheck, useKktSettings, useSaveKktSettings } from "@/hooks/use-kkt";
import {
  PAYMENT_METHOD_LABELS, PAYMENT_OBJECT_LABELS, SNO_LABELS, VAT_LABELS,
} from "@/lib/kkt-atol";

const SHIFT_LABEL: Record<string, string> = {
  opened: "смена открыта",
  closed: "смена закрыта",
  expired: "смена открыта больше 24 часов — закройте её",
  unknown: "состояние смены неизвестно",
};

export function KktSettingsPanel() {
  const wsId = useActiveWorkspaceId();
  const { settings, enabled, raw } = useKktSettings(wsId);
  const save = useSaveKktSettings(wsId);
  const [form, setForm] = useState(settings);
  const [on, setOn] = useState(enabled);

  useEffect(() => { setForm(settings); setOn(enabled); /* eslint-disable-next-line */ }, [
    settings.url, settings.sno, settings.vat, settings.paymentMethod, settings.paymentObject,
    settings.cashier, settings.cashierVatin, settings.place, enabled,
  ]);

  const check = useKktCheck(form);
  const upd = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const doSave = () =>
    save.mutate(
      {
        kkt_enabled: on,
        kkt_sno: form.sno,
        kkt_vat: form.vat,
        kkt_payment_method: form.paymentMethod,
        kkt_payment_object: form.paymentObject,
        kkt_cashier: form.cashier,
        kkt_cashier_vatin: form.cashierVatin,
        kkt_place: form.place,
        url: form.url,
      },
      { onSuccess: () => toast.success("Настройки кассы сохранены"), onError: (e: Error) => toast.error(e.message) },
    );

  return (
    <Card className="p-3 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">Онлайн-касса АТОЛ</div>
          <p className="text-xs text-muted-foreground">
            Чеки печатает касса, подключённая к компьютеру продавца. На этом компьютере должна быть
            установлена программа «Драйвер ККТ АТОЛ 10» с включённым веб-сервером.
          </p>
        </div>
        <Switch checked={on} onCheckedChange={setOn} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Адрес драйвера кассы (только для этого компьютера)</Label>
          <div className="flex gap-2">
            <Input value={form.url} onChange={(e) => upd("url", e.target.value)} className="h-9" placeholder="http://localhost:16732" />
            <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plug className="h-4 w-4 mr-1" />}
              Проверить связь
            </Button>
          </div>
          {check.isSuccess && (
            <p className="text-xs text-emerald-600">
              Касса {check.data.model}, заводской № {check.data.serial}, ФН {check.data.fnNumber} —{" "}
              {SHIFT_LABEL[check.data.shiftState]}
              {check.data.shiftNumber ? ` (№ ${check.data.shiftNumber})` : ""}.
            </p>
          )}
          {check.isError && <p className="text-xs text-destructive">{(check.error as Error).message}</p>}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Система налогообложения</Label>
          <Select value={form.sno} onValueChange={(v) => upd("sno", v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SNO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">НДС по позициям</Label>
          <Select value={form.vat} onValueChange={(v) => upd("vat", v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(VAT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Признак способа расчёта</Label>
          <Select value={form.paymentMethod} onValueChange={(v) => upd("paymentMethod", v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Признак предмета расчёта</Label>
          <Select value={form.paymentObject} onValueChange={(v) => upd("paymentObject", v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_OBJECT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Кассир в чеке</Label>
          <Input value={form.cashier} onChange={(e) => upd("cashier", e.target.value)} className="h-9" placeholder="Иванова И. И." />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">ИНН кассира (не обязательно)</Label>
          <Input value={form.cashierVatin} onChange={(e) => upd("cashierVatin", e.target.value)} className="h-9" />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Место расчётов (адрес магазина или сайт)</Label>
          <Input value={form.place} onChange={(e) => upd("place", e.target.value)} className="h-9" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-2">
        <p className="text-xs text-muted-foreground">
          {raw?.kkt_enabled ? "Кнопка «Пробить чек» доступна в расходных накладных." : "Пока выключено — кнопки «Пробить чек» в накладных нет."}
        </p>
        <Button onClick={doSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Сохранить
        </Button>
      </div>
    </Card>
  );
}
