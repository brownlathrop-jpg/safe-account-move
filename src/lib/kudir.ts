// КУДиР — книга учёта доходов и расходов при УСН.
// Форма и порядок заполнения: приказ ФНС России от 07.11.2023 № ЕА-7-3/816@.
// Раздел I заполняется в хронологическом порядке по первичным документам,
// итоги считаются за квартал и нарастающим итогом (I квартал, полугодие,
// 9 месяцев, год). Учёт кассовый: доход — по дате поступления денег,
// расход — по дате оплаты.

export type KudirMode = "all" | "receipts";

export type KudirRow = {
  /** Ключ строки. */
  id: string;
  /** Дата операции (YYYY-MM-DD) — дата поступления или оплаты. */
  date: string;
  /** Дата и номер первичного документа (графа 2). */
  doc: string;
  /** Содержание операции (графа 3). */
  content: string;
  /** Доходы, учитываемые при исчислении налоговой базы (графа 4). */
  income: number;
  /** Расходы, учитываемые при исчислении налоговой базы (графа 5). */
  expense: number;
  /** Пробит ли фискальный чек по операции. */
  hasReceipt: boolean;
  receiptNumber?: string | number | null;
};

export type KudirQuarter = {
  /** 1..4 */
  quarter: number;
  rows: (KudirRow & { no: number })[];
  income: number;
  expense: number;
  /** Нарастающим итогом с начала года. */
  incomeYtd: number;
  expenseYtd: number;
  /** Название накопительного итога: «за I квартал», «за полугодие» и т.д. */
  ytdLabel: string;
};

export type Kudir = {
  year: number;
  quarters: KudirQuarter[];
  income: number;
  expense: number;
  base: number;
};

const YTD_LABELS = ["за I квартал", "за полугодие", "за 9 месяцев", "за год"];

function r2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function filterKudirByMode(rows: KudirRow[], mode: KudirMode): KudirRow[] {
  return mode === "receipts" ? rows.filter((r) => r.hasReceipt) : rows;
}

export function buildKudir(rows: KudirRow[], year: number): Kudir {
  const ofYear = rows
    .filter((r) => Number(r.date.slice(0, 4)) === year)
    .sort((a, b) => (a.date === b.date ? a.doc.localeCompare(b.doc, "ru") : a.date < b.date ? -1 : 1));

  let no = 0;
  let incomeYtd = 0;
  let expenseYtd = 0;
  const quarters: KudirQuarter[] = [];
  for (let q = 1; q <= 4; q++) {
    const qRows = ofYear
      .filter((r) => Math.floor((Number(r.date.slice(5, 7)) - 1) / 3) + 1 === q)
      .map((r) => ({ ...r, no: ++no }));
    const income = r2(qRows.reduce((s, r) => s + (Number(r.income) || 0), 0));
    const expense = r2(qRows.reduce((s, r) => s + (Number(r.expense) || 0), 0));
    incomeYtd = r2(incomeYtd + income);
    expenseYtd = r2(expenseYtd + expense);
    quarters.push({
      quarter: q,
      rows: qRows,
      income,
      expense,
      incomeYtd,
      expenseYtd,
      ytdLabel: YTD_LABELS[q - 1]!,
    });
  }
  return { year, quarters, income: incomeYtd, expense: expenseYtd, base: r2(incomeYtd - expenseYtd) };
}

export type KudirOrg = {
  name: string;
  inn?: string;
  kpp?: string;
  legal_address?: string;
  taxation_system?: string;
  director_name?: string;
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

const ROMAN = ["I", "II", "III", "IV"];

/** Печать КУДиР: раздел I по кварталам и справка к разделу I. */
export function printKudir(
  book: Kudir,
  org: KudirOrg,
  opts: { mode: KudirMode; objectIncomeOnly: boolean; contribs?: KudirContribBook },
) {

  const blocks = book.quarters
    .filter((q) => q.rows.length)
    .map((q) => {
      const rows = q.rows
        .map(
          (r) => `<tr>
        <td class="c">${r.no}</td>
        <td>${esc(r.doc)}</td>
        <td>${esc(r.content)}${
          r.hasReceipt ? ` (чек${r.receiptNumber ? ` № ${esc(r.receiptNumber)}` : ""})` : ""
        }</td>
        <td class="r">${r.income ? money(r.income) : ""}</td>
        <td class="r">${r.expense ? money(r.expense) : ""}</td>
      </tr>`,
        )
        .join("");
      return `<h2>${ROMAN[q.quarter - 1]} квартал ${book.year} года</h2>
    <table>
      <thead>
        <tr>
          <th style="width:6%">№ п/п</th>
          <th style="width:20%">Дата и номер первичного документа</th>
          <th>Содержание операции</th>
          <th style="width:16%">Доходы, учитываемые при исчислении налоговой базы</th>
          <th style="width:16%">Расходы, учитываемые при исчислении налоговой базы</th>
        </tr>
        <tr class="nums"><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="sum"><td colspan="3">Итого за ${ROMAN[q.quarter - 1]} квартал</td><td class="r">${money(q.income)}</td><td class="r">${money(q.expense)}</td></tr>
        <tr class="sum"><td colspan="3">Итого ${esc(q.ytdLabel)}</td><td class="r">${money(q.incomeYtd)}</td><td class="r">${money(q.expenseYtd)}</td></tr>
      </tbody>
    </table>`;
    })
    .join("");

  const spravka = objectIncomeOnlyBlock(book, opts.objectIncomeOnly);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>КУДиР ${book.year}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 12mm; }
  .top { text-align: right; font-size: 10px; }
  h1 { font-size: 15px; text-align: center; margin: 10px 0 2px; }
  .meta { text-align: center; margin-bottom: 8px; }
  .org { margin-bottom: 8px; line-height: 1.6; }
  h2 { font-size: 12px; margin: 14px 0 4px; }
  table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
  th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  th { font-weight: normal; text-align: center; }
  tr.nums th { font-size: 9px; color: #333; }
  td.c { text-align: center; }
  td.r { text-align: right; }
  tr.sum td { font-weight: bold; }
  .signs { margin-top: 14px; line-height: 2; }
  @media print { body { margin: 10mm; } }
</style></head><body>
  <div class="top">Форма по КНД 1152017 · приказ ФНС России от 07.11.2023 № ЕА-7-3/816@</div>
  <h1>КНИГА УЧЁТА ДОХОДОВ И РАСХОДОВ</h1>
  <div class="meta">организаций и индивидуальных предпринимателей, применяющих упрощённую систему налогообложения, на ${book.year} год</div>
  <div class="org">
    Налогоплательщик: <b>${esc(org.name || "—")}</b><br>
    ИНН${org.kpp ? "/КПП" : ""}: ${esc(org.inn || "—")}${org.kpp ? ` / ${esc(org.kpp)}` : ""}<br>
    Адрес: ${esc(org.legal_address || "—")}<br>
    Объект налогообложения: ${opts.objectIncomeOnly ? "доходы" : "доходы, уменьшенные на величину расходов"}
    ${opts.mode === "receipts" ? "<br>Включены только документы с пробитым чеком" : ""}
  </div>
  <h2>Раздел I. Доходы и расходы</h2>
  ${blocks || "<p>За выбранный год операций нет.</p>"}
  ${spravka}
  <div class="signs">
    <div>Руководитель (индивидуальный предприниматель) ______________________ ${esc(org.director_name ?? "")}</div>
    <div>Дата: ${ruDate(new Date().toISOString())}</div>
  </div>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function objectIncomeOnlyBlock(book: Kudir, incomeOnly: boolean): string {
  if (incomeOnly) {
    return `<h2>Итого за ${book.year} год</h2>
    <table><tbody>
      <tr><td>Сумма полученных доходов за налоговый период</td><td class="r" style="width:22%">${money(book.income)}</td></tr>
    </tbody></table>`;
  }
  return `<h2>Справка к разделу I</h2>
    <table><tbody>
      <tr><td>010. Сумма полученных доходов за налоговый период</td><td class="r" style="width:22%">${money(book.income)}</td></tr>
      <tr><td>020. Сумма произведённых расходов за налоговый период</td><td class="r">${money(book.expense)}</td></tr>
      <tr><td>040. Налоговая база за налоговый период (010 − 020)</td><td class="r">${money(Math.max(0, book.base))}</td></tr>
      <tr><td>041. Сумма полученного убытка за налоговый период</td><td class="r">${money(book.base < 0 ? -book.base : 0)}</td></tr>
    </tbody></table>`;
}

// ---------------------------------------------------------------------------
// Раздел IV КУДиР — страховые взносы и иные платежи по п. 3.1 ст. 346.21 НК РФ,
// уменьшающие сумму налога при объекте «доходы».
// ---------------------------------------------------------------------------

export type KudirContribKind = "opc" | "oms" | "oss_nsp" | "oss_vnim" | "sick" | "volunt";

export const CONTRIB_KINDS: { id: KudirContribKind; label: string; col: number }[] = [
  { id: "opc", label: "Взносы на обязательное пенсионное страхование", col: 4 },
  { id: "oms", label: "Взносы на обязательное медицинское страхование", col: 5 },
  { id: "oss_nsp", label: "Взносы на страхование от несчастных случаев", col: 6 },
  { id: "oss_vnim", label: "Взносы на случай нетрудоспособности и материнства", col: 7 },
  { id: "sick", label: "Пособие по временной нетрудоспособности (за счёт работодателя)", col: 8 },
  { id: "volunt", label: "Платежи по добровольному личному страхованию", col: 9 },
];

export const CONTRIB_LABEL: Record<KudirContribKind, string> = Object.fromEntries(
  CONTRIB_KINDS.map((k) => [k.id, k.label]),
) as Record<KudirContribKind, string>;

export type KudirContrib = {
  id: string;
  /** Дата уплаты (YYYY-MM-DD). */
  date: string;
  /** Номер первичного документа (платёжное поручение, квитанция). */
  doc?: string;
  /** Период, за который произведена уплата (например «I квартал 2026» или «2025 год»). */
  period?: string;
  kind: KudirContribKind;
  amount: number;
  note?: string;
};

export type KudirContribQuarter = {
  quarter: number;
  rows: (KudirContrib & { no: number })[];
  byKind: Record<KudirContribKind, number>;
  total: number;
  byKindYtd: Record<KudirContribKind, number>;
  totalYtd: number;
  ytdLabel: string;
};

export type KudirContribBook = {
  year: number;
  quarters: KudirContribQuarter[];
  byKind: Record<KudirContribKind, number>;
  total: number;
};

const zeroByKind = (): Record<KudirContribKind, number> =>
  Object.fromEntries(CONTRIB_KINDS.map((k) => [k.id, 0])) as Record<KudirContribKind, number>;

export function buildContribBook(rows: KudirContrib[], year: number): KudirContribBook {
  const ofYear = rows
    .filter((r) => r.date && Number(r.date.slice(0, 4)) === year)
    .sort((a, b) => (a.date === b.date ? String(a.doc ?? "").localeCompare(String(b.doc ?? ""), "ru") : a.date < b.date ? -1 : 1));

  let no = 0;
  const ytd = zeroByKind();
  let totalYtd = 0;
  const quarters: KudirContribQuarter[] = [];
  for (let q = 1; q <= 4; q++) {
    const qRows = ofYear
      .filter((r) => Math.floor((Number(r.date.slice(5, 7)) - 1) / 3) + 1 === q)
      .map((r) => ({ ...r, no: ++no }));
    const byKind = zeroByKind();
    for (const r of qRows) byKind[r.kind] = r2(byKind[r.kind] + (Number(r.amount) || 0));
    const total = r2(Object.values(byKind).reduce((s, n) => s + n, 0));
    for (const k of CONTRIB_KINDS) ytd[k.id] = r2(ytd[k.id] + byKind[k.id]);
    totalYtd = r2(totalYtd + total);
    quarters.push({
      quarter: q,
      rows: qRows,
      byKind,
      total,
      byKindYtd: { ...ytd },
      totalYtd,
      ytdLabel: YTD_LABELS[q - 1]!,
    });
  }
  return { year, quarters, byKind: { ...ytd }, total: totalYtd };
}

/** Печать раздела IV отдельной страницей или в составе КУДиР. */
export function contribSectionHtml(book: KudirContribBook): string {
  const head = `<thead>
      <tr>
        <th style="width:5%">№ п/п</th>
        <th style="width:14%">Дата и номер первичного документа</th>
        <th style="width:12%">Период, за который произведена уплата</th>
        ${CONTRIB_KINDS.map((k) => `<th>${esc(k.label)}</th>`).join("")}
        <th style="width:10%">Итого</th>
      </tr>
      <tr class="nums">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => `<th>${n}</th>`).join("")}</tr>
    </thead>`;

  const blocks = book.quarters
    .filter((q) => q.rows.length)
    .map((q) => {
      const rows = q.rows
        .map(
          (r) => `<tr>
        <td class="c">${r.no}</td>
        <td>${esc(`${ruDate(r.date)}${r.doc ? ` № ${r.doc}` : ""}`)}</td>
        <td>${esc(r.period ?? "")}</td>
        ${CONTRIB_KINDS.map((k) => `<td class="r">${r.kind === k.id ? money(r.amount) : ""}</td>`).join("")}
        <td class="r">${money(r.amount)}</td>
      </tr>`,
        )
        .join("");
      return `<h2>${ROMAN[q.quarter - 1]} квартал ${book.year} года</h2>
    <table>${head}<tbody>
      ${rows}
      <tr class="sum"><td colspan="3">Итого за ${ROMAN[q.quarter - 1]} квартал</td>${CONTRIB_KINDS.map((k) => `<td class="r">${money(q.byKind[k.id])}</td>`).join("")}<td class="r">${money(q.total)}</td></tr>
      <tr class="sum"><td colspan="3">Итого ${esc(q.ytdLabel)}</td>${CONTRIB_KINDS.map((k) => `<td class="r">${money(q.byKindYtd[k.id])}</td>`).join("")}<td class="r">${money(q.totalYtd)}</td></tr>
    </tbody></table>`;
    })
    .join("");

  return `<h2>Раздел IV. Расходы, предусмотренные пунктом 3.1 статьи 346.21 НК РФ, уменьшающие сумму налога</h2>
  ${blocks || "<p>За выбранный год уплаченных взносов не внесено.</p>"}`;
}
