// Кнопка «Пробить чек» в накладной: подтверждение суммы и типа оплаты,
// печать чека на кассе АТОЛ и отметка о чеке в документе.
import { useState } from "react";
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
import { Receipt, Loader2, Copy } from "lucide-react";
import { useKktPrintReceipt, useKktSettings } from "@/hooks/use-kkt";
import {
  fnsCheckUrl, mergeServicesIntoGoods, printLastReceiptCopy, receiptTotal,
  type KktPaymentType, type KktPosition,
} from "@/lib/kkt-atol";

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

export type KktDocItem = {
  name: string; quantity: number; price: number; unit?: string;
  kind?: "product" | "service";
};

export function KktReceiptButton({
  wsId, invoiceId, items, fiscal,
}: {
  wsId: string | null | undefined;
  invoiceId: string;
  items: KktDocItem[];
  fiscal: any;
}) {
  const { settings, enabled } = useKktSettings(wsId);
  const [open, setOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<KktPaymentType>("cash");
  const [contact, setContact] = useState("");
  const print = useKktPrintReceipt(settings, invoiceId);

  if (!enabled) return null;

  const positions: KktPosition[] = items.map((i) => ({
    name: i.name, quantity: Number(i.quantity) || 0, price: Number(i.price) || 0, unit: i.unit,
  }));
  const total = receiptTotal(positions);

  if (fiscal?.receiptNumber || fiscal?.fiscalDocNumber) {
    const link = fnsCheckUrl(fiscal);
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Receipt className="h-3.5 w-3.5" /> Чек № {fiscal.receiptNumber ?? fiscal.fiscalDocNumber}
          {fiscal.shiftNumber ? ` · смена ${fiscal.shiftNumber}` : ""}
        </Badge>
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Receipt className="h-4 w-4 mr-1" /> Пробить чек
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пробить чек на кассе</DialogTitle>
            <DialogDescription>
              Чек напечатает касса, подключённая к этому компьютеру. Позиций: {positions.length}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-muted-foreground">Сумма чека</span>
              <span className="text-lg font-semibold">{fmt.format(total)}</span>
            </div>
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
              disabled={print.isPending || total <= 0}
              onClick={() =>
                print.mutate(
                  { positions, paymentType, clientContact: contact.trim() || undefined, operationId: invoiceId },
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
              Пробить чек
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
