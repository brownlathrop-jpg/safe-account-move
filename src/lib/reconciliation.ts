/**
 * Акт сверки взаиморасчётов с контрагентом.
 *
 * Считаем по данным нашей организации:
 *  · дебет  — задолженность контрагента перед нами (наши отгрузки, наши выплаты ему);
 *  · кредит — наша задолженность перед контрагентом (поступления от него, его оплаты нам).
 *
 * В расчёт попадают только учитываемые документы (проведённые накладные и
 * неотменённые кассовые ордера) — те же правила, что в отчётах и КУДиР.
 */
import { isAccounted } from "./accounting";
import { type PrintBrand, printHeaderHtml } from "./print-header";

export type ReconDoc = {
  id: string;
  number: string | null;
  issue_date: string;
  doc_type: string;
  kind: string;
  is_return?: boolean | null;
  total: number | null;
  status: string | null;
  organization_id?: string | null;
};

export type ReconPay = {
  id: string;
  invoice_id: string | null;
  amount: number | null;
  date: string;
  direction: "in" | "out" | string | null;
  method?: string | null;
  note?: string | null;
};

export type ReconRow = {
  date: string;
  title: string;
  debit: number;
  credit: number;
};

export type Reconciliation = {
  /** Сальдо на начало периода: > 0 — долг контрагента, < 0 — наш долг. */
  opening: number;
  rows: ReconRow[];
  debit: number;
  credit: number;
  /** Сальдо на конец периода. */
  closing: number;
};

const day = (v: string | null | undefined) => String(v ?? "").slice(0, 10);
const money = (v: number) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.round((v + Number.EPSILON) * 100) / 100,
  );
export const ruDate = (iso: string) => {
  const [y, m, d] = day(iso).split("-");
  return d ? `${d}.${m}.${y}` : day(iso);
};

function docOperation(d: ReconDoc): { date: string; title: string; debit: number; credit: number } | null {
  if (!isAccounted(d)) return null;
  const amount = Math.abs(Number(d.total || 0));
  if (!amount) return null;
  const num = String(d.number ?? "").replace(/^№\s*/, "");
  const date = day(d.issue_date);

  if (d.doc_type === "shipment") {
    const outgoing = d.kind === "outgoing";
    const ret = !!d.is_return;
    const title = outgoing
      ? ret
        ? `Возврат от покупателя № ${num}`
        : `Реализация (накладная) № ${num}`
      : ret
        ? `Возврат поставщику № ${num}`
        : `Поступление (накладная) № ${num}`;
    // Продажа увеличивает долг контрагента, поступление — наш долг; возвраты наоборот.
    const toUs = outgoing !== ret;
    return { date, title, debit: toUs ? amount : 0, credit: toUs ? 0 : amount };
  }
  return null;
}

function payOperation(p: ReconPay, docNumber: string | null): ReconRow | null {
  const amount = Math.abs(Number(p.amount || 0));
  if (!amount) return null;
  const incoming = (p.direction ?? "in") === "in";
  const num = docNumber ? ` по документу № ${String(docNumber).replace(/^№\s*/, "")}` : "";
  const how = p.method === "cash" ? "наличными" : p.method === "card" ? "картой" : "на счёт";
  return {
    date: day(p.date),
    title: incoming ? `Оплата от контрагента ${how}${num}` : `Оплата контрагенту ${how}${num}`,
    debit: incoming ? 0 : amount,
    credit: incoming ? amount : 0,
  };
}

/** Собрать акт сверки за период по одному контрагенту (и одной организации). */
export function buildReconciliation(
  docs: ReconDoc[],
  pays: ReconPay[],
  opts: { from: string; to: string; orgId?: string | null },
): Reconciliation {
  const orgId = opts.orgId ?? null;
  const inOrg = (d: ReconDoc) => !orgId || (d.organization_id ?? null) === orgId;
  const allowed = new Map<string, ReconDoc>();
  const ops: ReconRow[] = [];

  for (const d of docs) {
    if (!inOrg(d)) continue;
    allowed.set(d.id, d);
    const op = docOperation(d);
    if (op) ops.push(op);
  }
  for (const p of pays) {
    // Оплата учитывается, если её документ относится к выбранной организации.
    if (p.invoice_id && !allowed.has(p.invoice_id)) continue;
    const doc = p.invoice_id ? allowed.get(p.invoice_id) : null;
    if (p.invoice_id && doc && !isAccounted(doc)) continue;
    const op = payOperation(p, doc?.number ?? null);
    if (op) ops.push(op);
  }

  ops.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title, "ru") : a.date.localeCompare(b.date)));

  const from = day(opts.from);
  const to = day(opts.to);
  let opening = 0;
  const rows: ReconRow[] = [];
  let debit = 0;
  let credit = 0;

  for (const op of ops) {
    if (op.date < from) {
      opening += op.debit - op.credit;
      continue;
    }
    if (op.date > to) continue;
    rows.push(op);
    debit += op.debit;
    credit += op.credit;
  }

  const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  return {
    opening: round(opening),
    rows,
    debit: round(debit),
    credit: round(credit),
    closing: round(opening + debit - credit),
  };
}

/** Словесное пояснение к сальдо для печатной формы. */
export function balanceNote(closing: number, orgName: string, partnerName: string): string {
  if (Math.abs(closing) < 0.005) return "На конец периода задолженность отсутствует.";
  if (closing > 0) {
    return `На конец периода задолженность ${partnerName} перед ${orgName} составляет ${money(closing)} руб.`;
  }
  return `На конец периода задолженность ${orgName} перед ${partnerName} составляет ${money(-closing)} руб.`;
}

function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Печать акта сверки: двусторонняя форма с местом для подписей и печатей. */
export function printReconciliation(
  recon: Reconciliation,
  org: (PrintBrand & { director_name?: string | null }) | null,
  partner: { name?: string | null; inn?: string | null } | null,
  period: { from: string; to: string },
) {
  const orgName = org?.print_name?.trim() || org?.name || "Наша организация";
  const partnerName = partner?.name || "Контрагент";
  const sideOpening = (v: number) => ({
    debit: v > 0 ? money(v) : "",
    credit: v < 0 ? money(-v) : "",
  });
  const op = sideOpening(recon.opening);
  const cl = sideOpening(recon.closing);

  const body = recon.rows
    .map(
      (r) => `<tr>
    <td class="c">${esc(ruDate(r.date))}</td>
    <td>${esc(r.title)}</td>
    <td class="r">${r.debit ? money(r.debit) : ""}</td>
    <td class="r">${r.credit ? money(r.credit) : ""}</td>
    <td class="r">${r.debit ? money(r.debit) : ""}</td>
    <td class="r">${r.credit ? money(r.credit) : ""}</td>
  </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Акт сверки</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
  h1 { font-size: 15px; text-align: center; margin: 10px 0 2px; }
  .sub { text-align: center; margin-bottom: 10px; }
  .parties { margin-bottom: 10px; line-height: 1.5; }
  table.act { border-collapse: collapse; width: 100%; }
  table.act th, table.act td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  table.act th { background: #f2f2f2; text-align: center; font-weight: bold; }
  .c { text-align: center; }
  .r { text-align: right; }
  .sum td { font-weight: bold; }
  .note { margin-top: 10px; font-weight: bold; }
  .signs { margin-top: 26px; width: 100%; border-collapse: collapse; }
  .signs td { width: 50%; vertical-align: top; padding-right: 16px; }
  .line { border-bottom: 1px solid #000; height: 28px; margin-top: 18px; }
  .cap { font-size: 9px; }
</style></head><body>
${printHeaderHtml(org)}
<h1>Акт сверки взаимных расчётов</h1>
<div class="sub">за период с ${esc(ruDate(period.from))} по ${esc(ruDate(period.to))}</div>
<div class="parties">
  между <b>${esc(orgName)}</b>${org?.inn ? `, ИНН ${esc(org.inn)}` : ""}<br/>
  и <b>${esc(partnerName)}</b>${partner?.inn ? `, ИНН ${esc(partner.inn)}` : ""}
</div>
<table class="act">
  <thead>
    <tr>
      <th rowspan="2" style="width:9%">Дата</th>
      <th rowspan="2">Документ, операция</th>
      <th colspan="2">По данным ${esc(orgName)}</th>
      <th colspan="2">По данным ${esc(partnerName)}</th>
    </tr>
    <tr>
      <th style="width:12%">Дебет</th>
      <th style="width:12%">Кредит</th>
      <th style="width:12%">Дебет</th>
      <th style="width:12%">Кредит</th>
    </tr>
  </thead>
  <tbody>
    <tr class="sum"><td class="c">${esc(ruDate(period.from))}</td><td>Сальдо на начало периода</td>
      <td class="r">${op.debit}</td><td class="r">${op.credit}</td>
      <td class="r">${op.debit}</td><td class="r">${op.credit}</td></tr>
    ${body}
    <tr class="sum"><td></td><td>Обороты за период</td>
      <td class="r">${money(recon.debit)}</td><td class="r">${money(recon.credit)}</td>
      <td class="r">${money(recon.debit)}</td><td class="r">${money(recon.credit)}</td></tr>
    <tr class="sum"><td class="c">${esc(ruDate(period.to))}</td><td>Сальдо на конец периода</td>
      <td class="r">${cl.debit}</td><td class="r">${cl.credit}</td>
      <td class="r">${cl.debit}</td><td class="r">${cl.credit}</td></tr>
  </tbody>
</table>
<div class="note">${esc(balanceNote(recon.closing, orgName, partnerName))}</div>
<table class="signs">
  <tr>
    <td>
      <div><b>От ${esc(orgName)}</b></div>
      <div class="line"></div>
      <div class="cap">должность, подпись, расшифровка${org?.director_name ? ` (${esc(org.director_name)})` : ""}</div>
      <div style="margin-top:14px" class="cap">М.П.</div>
    </td>
    <td>
      <div><b>От ${esc(partnerName)}</b></div>
      <div class="line"></div>
      <div class="cap">должность, подпись, расшифровка</div>
      <div style="margin-top:14px" class="cap">М.П.</div>
    </td>
  </tr>
</table>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
