// Печать списка в отдельном окне (дальше — «Сохранить как PDF» в диалоге печати).
import type { CsvColumn } from "./export-csv";
import { type PrintBrand, printHeaderHtml } from "./print-header";

function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printList<T>(title: string, rows: T[], columns: CsvColumn<T>[], org?: PrintBrand | null) {
  if (!rows.length) return;
  const head = columns.map(c => `<th>${esc(c.header)}</th>`).join("");
  const body = rows
    .map(r => `<tr>${columns.map(c => `<td>${esc(c.value(r))}</td>`).join("")}</tr>`)
    .join("");
  const stamp = new Date().toLocaleDateString("ru-RU");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #666; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  @media print { body { margin: 0; } }
</style></head><body>
${printHeaderHtml(org)}
<h1>${esc(title)}</h1>
<div class="meta">Дата: ${stamp} · строк: ${rows.length}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
