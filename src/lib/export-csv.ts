// Выгрузка таблиц в файл для Excel (CSV с разделителем ";" и BOM).

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(";");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(";"));
  return [head, ...body].join("\r\n");
}

/** Скачивает данные как CSV-файл, который открывается в Excel. */
export function downloadCsv<T>(fileName: string, rows: T[], columns: CsvColumn<T>[]) {
  const csv = "\uFEFF" + buildCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${fileName}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvDate = (v: any) => (v ? String(v).slice(0, 10).split("-").reverse().join(".") : "");
