/**
 * Общие правила учёта для всех отчётов.
 *
 * Накладная влияет на деньги, налоги и склад только после проведения:
 * черновики и отменённые документы в отчёты не попадают — иначе КУДиР и
 * кассовая книга расходятся с отчётами по продажам и долгам.
 *
 * Кассовые ордера (ПКО/РКО) — это факт движения денег, они учитываются сразу
 * (отдельного проведения у них нет), достаточно чтобы ордер не был отменён.
 */
export type AccountedDoc = { status?: string | null; doc_type?: string | null } | null | undefined;

/** Учитывается ли документ в отчётах. */
export function isAccounted(doc: AccountedDoc): boolean {
  if (!doc) return false;
  const status = String(doc.status ?? "");
  if (status === "cancelled") return false;
  if (doc.doc_type === "cash_receipt") return true;
  return status === "posted";
}

/** Сумма оплаты со знаком: приход денег +, возврат денег −. */
export function signedPayment(p: { amount?: any; direction?: any }): number {
  const amount = Number(p?.amount || 0);
  return (p?.direction ?? "in") === "in" ? amount : -amount;
}
