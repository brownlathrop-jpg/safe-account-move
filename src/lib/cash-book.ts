import { type PrintBrand, printHeaderHtml } from "./print-header";
// Кассовая книга (унифицированная форма КО-4, ОКУД 0310004).
// Правила: Указание Банка России от 11.03.2014 № 3210-У — записи вносятся
// по каждому приходному и расходному кассовому документу, за каждый день
// выводятся «Итого за день» и «Остаток на конец дня», листы нумеруются,
// в дни без операций лист не заполняется.

export type CashBookMode = "all" | "receipts";

/** Документ-источник записи в кассовой книге. */
export type CashBookDoc = {
  id: string;
  number: string;
  /** Дата документа (YYYY-MM-DD). */
  date: string;
  /** Приход или расход наличных. */
  direction: "in" | "out";
  amount: number;
  /** От кого получено / кому выдано. */
  party: string;
  /** Основание (содержание операции). */
  note: string;
  /** Номер корреспондирующего счёта (если ведётся). */
  account?: string;
  /** Пробит ли фискальный чек по документу. */
  hasReceipt: boolean;
  receiptNumber?: string | number | null;
};

export type CashBookRow = CashBookDoc;

export type CashBookDay = {
  date: string;
  sheet: number;
  opening: number;
  income: number;
  expense: number;
  closing: number;
  rows: CashBookRow[];
  /** Сколько приходных и расходных документов за день. */
  inCount: number;
  outCount: number;
};

export type CashBook = {
  days: CashBookDay[];
  opening: number;
  income: number;
  expense: number;
  closing: number;
};

function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function filterByMode(docs: CashBookDoc[], mode: CashBookMode): CashBookDoc[] {
  return mode === "receipts" ? docs.filter((d) => d.hasReceipt) : docs;
}

/** Остаток наличных на начало периода: все операции до даты `from`. */
export function openingBalance(docs: CashBookDoc[], from: string): number {
  return r2(
    docs
      .filter((d) => !from || d.date < from)
      .reduce((s, d) => s + (d.direction === "in" ? Number(d.amount) || 0 : -(Number(d.amount) || 0)), 0),
  );
}

/**
 * Сборка кассовой книги: документы группируются по дням, для каждого дня
 * считаются итоги и остаток. Дни без операций пропускаются, листы нумеруются
 * подряд начиная с `firstSheet`.
 */
export function buildCashBook(
  docs: CashBookDoc[],
  opts: { from?: string; to?: string; opening?: number; firstSheet?: number } = {},
): CashBook {
  const from = opts.from ?? "";
  const to = opts.to ?? "";
  const inPeriod = docs
    .filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
    .sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number, "ru") : a.date < b.date ? -1 : 1));

  const byDate = new Map<string, CashBookRow[]>();
  for (const d of inPeriod) {
    const arr = byDate.get(d.date) ?? [];
    arr.push(d);
    byDate.set(d.date, arr);
  }

  let balance = r2(opts.opening ?? 0);
  const opening = balance;
  let sheet = opts.firstSheet ?? 1;
  const days: CashBookDay[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const rows = byDate.get(date)!;
    const income = r2(rows.filter((r) => r.direction === "in").reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const expense = r2(rows.filter((r) => r.direction === "out").reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const dayOpening = balance;
    balance = r2(balance + income - expense);
    days.push({
      date,
      sheet: sheet++,
      opening: dayOpening,
      income,
      expense,
      closing: balance,
      rows,
      inCount: rows.filter((r) => r.direction === "in").length,
      outCount: rows.filter((r) => r.direction === "out").length,
    });
  }

  return {
    days,
    opening,
    income: r2(days.reduce((s, d) => s + d.income, 0)),
    expense: r2(days.reduce((s, d) => s + d.expense, 0)),
    closing: balance,
  };
}

export type CashBookOrg = PrintBrand & {
  name: string;
  okpo?: string;
  director_name?: string;
  accountant_name?: string;
};

const money = (n: number) =>
  (Number(n) || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ruDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Печать кассовой книги по форме КО-4: отдельный лист на каждый день. */
export function printCashBook(
  book: CashBook,
  org: CashBookOrg,
  opts: { cashier?: string; mode: CashBookMode; from?: string; to?: string },
) {
  if (!book.days.length) return;
  const cashier = opts.cashier || "";
  const sheets = book.days
    .map((day) => {
      const rows = day.rows
        .map(
          (r) => `<tr>
        <td class="c">${esc(r.number)}</td>
        <td>${esc(r.party || "—")}${r.note ? ` · ${esc(r.note)}` : ""}${
          r.hasReceipt ? ` (чек${r.receiptNumber ? ` № ${esc(r.receiptNumber)}` : ""})` : ""
        }</td>
        <td class="c">${esc(r.account ?? "")}</td>
        <td class="r">${r.direction === "in" ? money(r.amount) : ""}</td>
        <td class="r">${r.direction === "out" ? money(r.amount) : ""}</td>
      </tr>`,
        )
        .join("");
      return `<section class="sheet">
    <div class="sheet-head">
      <div><b>Касса за ${esc(ruDate(day.date))}</b></div>
      <div>Лист ${day.sheet}</div>
    </div>
    <table class="book">
      <thead>
        <tr>
          <th style="width:12%">Номер документа</th>
          <th>От кого получено или кому выдано</th>
          <th style="width:14%">Номер корреспондирующего счёта, субсчёта</th>
          <th style="width:14%">Приход, руб. коп.</th>
          <th style="width:14%">Расход, руб. коп.</th>
        </tr>
      </thead>
      <tbody>
        <tr class="sum"><td></td><td>Остаток на начало дня</td><td class="c">х</td><td class="r">${money(day.opening)}</td><td class="c">х</td></tr>
        ${rows}
        <tr class="sum"><td></td><td>Итого за день</td><td class="c">х</td><td class="r">${money(day.income)}</td><td class="r">${money(day.expense)}</td></tr>
        <tr class="sum"><td></td><td>Остаток на конец дня</td><td class="c">х</td><td class="r">${money(day.closing)}</td><td class="c">х</td></tr>
        <tr><td></td><td>в том числе на заработную плату, выплаты социального характера и стипендии</td><td class="c">х</td><td class="r"></td><td class="c">х</td></tr>
      </tbody>
    </table>
    <div class="signs">
      <div>Кассир ______________________ <span class="small">подпись</span> ${esc(cashier)}</div>
      <div>Записи в кассовой книге проверил и документов ${day.inCount} приходных и ${day.outCount} расходных получил.</div>
      <div>Бухгалтер ______________________ <span class="small">подпись</span> ${esc(org.accountant_name ?? "")}</div>
    </div>
  </section>`;
    })
    .join("");

  const periodText = [opts.from ? `с ${ruDate(opts.from)}` : "", opts.to ? `по ${ruDate(opts.to)}` : ""]
    .filter(Boolean)
    .join(" ");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Кассовая книга</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 14mm; }
  .okud { text-align: right; font-size: 10px; margin-bottom: 6px; }
  .org { font-size: 12px; margin-bottom: 2px; }
  h1 { font-size: 15px; margin: 10px 0 2px; text-align: center; }
  .meta { text-align: center; margin-bottom: 10px; }
  .sheet { page-break-after: always; margin-bottom: 18px; }
  .sheet:last-child { page-break-after: auto; }
  .sheet-head { display: flex; justify-content: space-between; margin: 8px 0 4px; }
  table.book { border-collapse: collapse; width: 100%; }
  table.book th, table.book td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  table.book th { text-align: center; font-weight: normal; }
  td.c { text-align: center; }
  td.r { text-align: right; }
  tr.sum td { font-weight: bold; }
  .signs { margin-top: 10px; line-height: 1.9; }
  .small { font-size: 9px; color: #444; }
  .total { margin-top: 12px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
  ${printHeaderHtml(org)}
  <div class="okud">Унифицированная форма № КО-4 · ОКУД 0310004</div>
  <div class="org"><b>${esc(org.name || "Организация")}</b>${org.okpo ? ` · ОКПО ${esc(org.okpo)}` : ""}</div>
  <h1>КАССОВАЯ КНИГА</h1>
  <div class="meta">${esc(periodText)}${
    opts.mode === "receipts" ? " · только документы с пробитым чеком" : ""
  }</div>
  ${sheets}
  <div class="total">
    <b>Итого за период:</b> остаток на начало ${money(book.opening)} ·
    приход ${money(book.income)} · расход ${money(book.expense)} ·
    остаток на конец ${money(book.closing)} руб.
  </div>
  <div class="signs">
    <div>Руководитель ______________________ ${esc(org.director_name ?? "")}</div>
    <div>Главный бухгалтер ______________________ ${esc(org.accountant_name ?? "")}</div>
  </div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
