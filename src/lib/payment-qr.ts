/**
 * Платёжный QR-код для счёта на оплату по ГОСТ Р 56042-2014 (формат ST00012).
 *
 * Такой код читают банковские приложения (Сбербанк, Т-Банк, ВТБ, Альфа и др.):
 * покупатель наводит камеру на счёт — реквизиты, сумма и назначение платежа
 * подставляются сами, без ручного ввода.
 */
import QRCode from "qrcode";

export type PaymentQrData = {
  /** Получатель платежа (наименование организации). */
  name?: string | null;
  /** Расчётный счёт получателя (20 цифр). */
  personalAcc?: string | null;
  bankName?: string | null;
  /** БИК банка получателя (9 цифр). */
  bic?: string | null;
  /** Корреспондентский счёт банка. */
  correspAcc?: string | null;
  payeeInn?: string | null;
  kpp?: string | null;
  /** Сумма к оплате в рублях (в код пишутся копейки). */
  sum?: number | null;
  /** Назначение платежа. */
  purpose?: string | null;
};

const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
const clean = (v: string | null | undefined) =>
  String(v ?? "")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Строка платёжного QR-кода. Возвращает null, если не хватает обязательных
 * реквизитов (получатель, счёт, БИК) — тогда код просто не печатается.
 */
export function paymentQrPayload(d: PaymentQrData): string | null {
  const name = clean(d.name);
  const acc = digits(d.personalAcc);
  const bic = digits(d.bic);
  if (!name || acc.length !== 20 || bic.length !== 9) return null;

  const parts = [
    `Name=${name.slice(0, 160)}`,
    `PersonalAcc=${acc}`,
    `BankName=${clean(d.bankName).slice(0, 160)}`,
    `BIC=${bic}`,
    `CorrespAcc=${digits(d.correspAcc)}`,
  ];
  const inn = digits(d.payeeInn);
  if (inn) parts.push(`PayeeINN=${inn}`);
  const kpp = digits(d.kpp);
  if (kpp) parts.push(`KPP=${kpp}`);
  const sum = Number(d.sum ?? 0);
  if (sum > 0) parts.push(`Sum=${Math.round(sum * 100)}`);
  const purpose = clean(d.purpose);
  if (purpose) parts.push(`Purpose=${purpose.slice(0, 210)}`);

  return `ST00012|${parts.join("|")}`;
}

/** Картинка QR-кода (data URL) или пустая строка, если реквизитов не хватает. */
export async function paymentQrDataUrl(d: PaymentQrData, size = 480): Promise<string> {
  const payload = paymentQrPayload(d);
  if (!payload) return "";
  try {
    return await QRCode.toDataURL(payload, { margin: 0, width: size, errorCorrectionLevel: "M" });
  } catch {
    return "";
  }
}
