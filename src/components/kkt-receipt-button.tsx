// Кнопка «Пробить чек» в накладной: подтверждение суммы и типа оплаты,
// печать чека на кассе АТОЛ и отметка о чеке в документе.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Receipt, Loader2, Copy, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useKktPrintReceipt, useKktSettings, useKktShift, useKktShiftAction } from "@/hooks/use-kkt";
import {
  fnsCheckUrl, fnsQrPayload, mergeServicesIntoGoods, printLastReceiptCopy, receiptTotal,
  type KktPaymentType, type KktPosition,
} from "@/lib/kkt-atol";

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

export type KktDocItem = {
  name: string; quantity: number; price: number; unit?: string;
  kind?: "product" | "service";
};

export function KktReceiptButton({
  wsId, invoiceId, items, fiscal, defaultPaymentType = "cash", isReturn = false,
}: {
  wsId: string | null | undefined;
  invoiceId: string;
  items: KktDocItem[];
  fiscal: any;
  defaultPaymentType?: KktPaymentType;
  /** Возвратная накладная — пробивается чек возврата продажи. */
  isReturn?: boolean;
}) {
  const { settings, enabled } = useKktSettings(wsId);
  const [open, setOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<KktPaymentType>(defaultPaymentType);
  useEffect(() => { setPaymentType(defaultPaymentType); }, [defaultPaymentType]);
  const [contact, setContact] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [mergeServices, setMergeServices] = useState(false);
  const print = useKktPrintReceipt(settings, invoiceId);
  const shift = useKktShift(settings, open);
  const shiftAction = useKktShiftAction(settings);
  const shiftState = shift.data?.shiftState;
  // Если касса не сообщила состояние смены — не запрещаем печать: касса сама
  // откажет, если смена закрыта, и мы покажем её ответ.
  const shiftOk = shiftState === "opened" || shiftState === "unknown";


  if (!enabled) return null;

  const allPositions: KktPosition[] = items.map((i) => ({
    name: i.name, quantity: Number(i.quantity) || 0, price: Number(i.price) || 0, unit: i.unit,
    kind: i.kind ?? "product",
  }));
  const hasServices = allPositions.some((p) => p.kind === "service" && p.quantity > 0);
  let positions = allPositions;
  let mergeError = "";
  if (mergeServices && hasServices) {
    try {
      positions = mergeServicesIntoGoods(allPositions);
    } catch (e) {
      mergeError = (e as Error).message;
      positions = allPositions;
    }
  }
  const total = receiptTotal(positions);
  const received = Number(String(cashReceived).replace(",", ".")) || 0;
  const change = paymentType === "cash" && received > total ? Math.round((received - total) * 100) / 100 : 0;

  if (fiscal?.receiptNumber || fiscal?.fiscalDocNumber) {
    const link = fnsCheckUrl(fiscal);
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Receipt className="h-3.5 w-3.5" />
          {fiscal.isReturn ? "Чек возврата № " : "Чек № "}
          {fiscal.receiptNumber ?? fiscal.fiscalDocNumber}
          {fiscal.shiftNumber ? ` · смена ${fiscal.shiftNumber}` : ""}
        </Badge>
        <FiscalQr fiscal={fiscal} />
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground underline">
            Проверить в ФНС
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            printLastReceiptCopy(settings)
              .then(() => toast.success("Копия чека отправлена на печать"))
              .catch((e: Error) => toast.error(e.message))
          }
        >
          <Copy className="h-4 w-4 mr-1" /> Копия чека
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-muted-foreground">Чек не пробит</Badge>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Receipt className="h-4 w-4 mr-1" /> Пробить чек
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пробить чек на кассе</DialogTitle>
            <DialogDescription>
              Чек напечатает касса, подключённая к этому компьютеру. Позиций: {positions.length}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-2">
              {shift.isLoading ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Проверяем кассу и смену…
                </p>
              ) : shift.isError ? (
                <>
                  <p className="text-destructive">{(shift.error as Error).message}</p>
                  <Button variant="outline" size="sm" onClick={() => shift.refetch()}>Проверить снова</Button>
                </>
              ) : shiftOk ? (
                <p className="text-muted-foreground">
                  Касса {shift.data?.model} · смена {shift.data?.shiftNumber ?? "—"} открыта — можно пробивать чек.
                </p>
              ) : (
                <>
                  <p className="font-medium">
                    {shift.data?.shiftState === "expired"
                      ? "Смена открыта больше 24 часов — по закону чек пробить нельзя. Нужно закрыть смену и открыть новую."
                      : "Смена на кассе закрыта — чек пробить нельзя. Откройте смену."}
                  </p>
                  <Button
                    size="sm"
                    disabled={shiftAction.isPending}
                    onClick={() =>
                      shiftAction.mutate(shift.data?.shiftState === "expired" ? "reopen" : "open", {
                        onSuccess: () => toast.success("Смена открыта"),
                        onError: (e: Error) => toast.error(e.message),
                      })
                    }
                  >
                    {shiftAction.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    {shift.data?.shiftState === "expired" ? "Закрыть смену и открыть новую" : "Открыть смену"}
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-muted-foreground">Сумма чека</span>
              <span className="text-lg font-semibold">{fmt.format(total)}</span>
            </div>
            {hasServices && (
              <div className="rounded-md border p-3 space-y-1">
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={mergeServices}
                    onCheckedChange={(v) => setMergeServices(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Услуги в стоимость товара
                    <span className="block text-xs text-muted-foreground">
                      Стоимость услуг распределится по товарам (округление до рубля), отдельными строками услуги в чек не попадут. Сумма чека не изменится.
                    </span>
                  </span>
                </label>
                {mergeError && <p className="text-xs text-destructive">{mergeError}</p>}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Оплата</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as KktPaymentType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Наличными</SelectItem>
                  <SelectItem value="electronically">Картой (безналичными)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentType === "cash" && (
              <div className="space-y-1">
                <Label className="text-xs">Получено наличными (не обязательно)</Label>
                <Input
                  inputMode="decimal"
                  placeholder={total.toFixed(2)}
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="h-9"
                />
                {change > 0 && (
                  <p className="text-xs text-muted-foreground">Сдача: {fmt.format(change)}</p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Электронный чек покупателю (не обязательно)</Label>
              <Input
                placeholder="почта или телефон"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              disabled={print.isPending || total <= 0 || !!mergeError || !shiftOk}
              onClick={() =>
                print.mutate(
                  {
                    positions,
                    paymentType,
                    clientContact: contact.trim() || undefined,
                    operationId: invoiceId,
                    isReturn,
                    cashReceived: received || undefined,
                  },
                  {
                    onSuccess: (f) => {
                      setOpen(false);
                      toast.success(`Чек № ${f.receiptNumber ?? f.fiscalDocNumber ?? ""} пробит`);
                    },
                    onError: (e: Error) => toast.error(e.message),
                  },
                )
              }
            >
              {print.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Receipt className="h-4 w-4 mr-1" />}
              {isReturn ? "Пробить чек возврата" : "Пробить чек"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Фискальный QR-код чека (тег 1196) — тот же, что печатает касса. */
function FiscalQr({ fiscal }: { fiscal: any }) {
  const [img, setImg] = useState<string>("");
  const [open, setOpen] = useState(false);
  const payload = fnsQrPayload(fiscal);
  useEffect(() => {
    if (!open || !payload) return;
    QRCode.toDataURL(payload, { margin: 1, width: 240 }).then(setImg).catch(() => setImg(""));
  }, [open, payload]);
  if (!payload) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4 mr-1" /> QR-код чека
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>QR-код чека</DialogTitle>
            <DialogDescription>Отсканируйте в приложении «Проверка чека» ФНС.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-2">
            {img ? <img src={img} alt="QR-код чека" className="h-60 w-60" /> : <Loader2 className="h-6 w-6 animate-spin" />}
            <code className="text-[10px] break-all text-muted-foreground">{payload}</code>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
