/**
 * Общие правила учёта для всех отчётов.
 *
 * Документ считается учтённым (влияет на деньги, налоги и склад), только если
 * он проведён. Черновики и отменённые документы в отчёты не попадают — иначе
 * КУДиР и кассовая книга расходятся с отчётами по продажам и долгам.
 */
export type AccountedDoc = { status?: string | null } | null | undefined;

/** Проведён ли документ (не черновик и не отменён). */
export function isAccounted(doc: AccountedDoc): boolean {
  return (doc?.status ?? "") === "posted";
}

/** Сумма оплаты со знаком: приход в кассу +, возврат денег −. */
export function signedPayment(p: { amount?: any; direction?: any }): number {
  const amount = Number(p?.amount || 0);
  return (p?.direction ?? "in") === "in" ? amount : -amount;
}
