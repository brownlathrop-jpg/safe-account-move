// НДС в документах: ставка по строке и режим расчёта по документу.
//
// Режимы (vat_mode) документа:
//   "none"     — без НДС (спецрежимы: УСН без НДС, патент, НПД);
//   "included" — цены указаны с НДС, налог выделяется из суммы строки;
//   "added"    — НДС начисляется сверх цены и увеличивает сумму к оплате.
//
// Во всех режимах сумма строки (`sum`) и итог документа (`total`) — это
// сумма к оплате (с НДС). Так долги, оплаты и касса считаются как раньше.

export type VatMode = "none" | "included" | "added";

/** Ставка НДС: null — «без НДС». */
export type VatRate = number | null;

export const VAT_MODES: { id: VatMode; label: string }[] = [
  { id: "none", label: "Без НДС" },
  { id: "included", label: "НДС в цене" },
  { id: "added", label: "НДС сверх цены" },
];

/** Ставки, действующие с 2025 года (включая пониженные 5 % и 7 % для УСН с НДС). */
export const VAT_RATES: { id: string; label: string; rate: VatRate }[] = [
  { id: "none", label: "без НДС", rate: null },
  { id: "0", label: "0 %", rate: 0 },
  { id: "5", label: "5 %", rate: 5 },
  { id: "7", label: "7 %", rate: 7 },
  { id: "10", label: "10 %", rate: 10 },
  { id: "20", label: "20 %", rate: 20 },
];

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Приводит значение из базы к ставке НДС. */
export function toVatRate(v: unknown): VatRate {
  if (v === null || v === undefined || v === "" || v === "none") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Ставка как значение для Select. */
export function vatRateId(rate: VatRate): string {
  return rate === null ? "none" : String(rate);
}

/** Подпись ставки для печати: «20 %» или «без НДС». */
export function vatRateLabel(rate: VatRate, mode: VatMode = "included"): string {
  if (mode === "none" || rate === null) return "без НДС";
  return `${rate} %`;
}

export type VatSplit = {
  /** Сумма без НДС. */
  net: number;
  /** Сумма НДС. */
  vat: number;
  /** Сумма с НДС (к оплате). */
  gross: number;
};

/**
 * Раскладывает сумму строки на «без НДС / НДС / с НДС».
 * `sum` — сумма строки со скидкой в том виде, в котором её вводит пользователь:
 * в режиме «НДС в цене» это сумма с налогом, в режиме «НДС сверх цены» — без него.
 */
export function splitVat(sum: number, rate: VatRate, mode: VatMode): VatSplit {
  const s = r2(sum);
  if (mode === "none" || rate === null || !rate) return { net: s, vat: 0, gross: s };
  if (mode === "included") {
    const vat = r2((s * rate) / (100 + rate));
    return { net: r2(s - vat), vat, gross: s };
  }
  const vat = r2((s * rate) / 100);
  return { net: s, vat, gross: r2(s + vat) };
}

/** Итоги документа по списку строк. */
export function sumVat(
  rows: { sum: number; vat_rate?: VatRate }[],
  mode: VatMode,
): VatSplit & { byRate: Record<string, number> } {
  let net = 0, vat = 0, gross = 0;
  const byRate: Record<string, number> = {};
  for (const row of rows) {
    const s = splitVat(row.sum, toVatRate(row.vat_rate ?? null), mode);
    net = r2(net + s.net);
    vat = r2(vat + s.vat);
    gross = r2(gross + s.gross);
    if (s.vat) {
      const key = vatRateId(toVatRate(row.vat_rate ?? null));
      byRate[key] = r2((byRate[key] ?? 0) + s.vat);
    }
  }
  return { net, vat, gross, byRate };
}

/** Режим НДС по умолчанию для организации: на ОСН — НДС в цене, иначе без НДС. */
export function defaultVatMode(taxationSystem?: string | null): VatMode {
  const t = String(taxationSystem ?? "");
  return t === "osn" || t === "usn_nds" ? "included" : "none";
}

/** Ставка по умолчанию для организации. */
export function defaultVatRate(org: { vat_rate?: unknown; taxation_system?: string | null } | null): VatRate {
  if (!org) return null;
  if (org.vat_rate !== undefined && org.vat_rate !== null && org.vat_rate !== "") return toVatRate(org.vat_rate);
  return defaultVatMode(org.taxation_system) === "none" ? null : 20;
}
