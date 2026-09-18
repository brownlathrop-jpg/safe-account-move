// Загрузка прайсов и остатков из Excel/CSV.
// Файл: первая строка — заголовки, разделитель ; , или табуляция.
// Распознаём: наименование, артикул, код 1С, цена, закуп/себестоимость, остаток,
// а также колонки, названные так же, как типы цен из настроек.

import { db } from "@/integrations/db";
import type { PriceType } from "@/lib/price-types";

export type PriceRow = {
  name: string;
  sku: string;
  ext: string;
  price: number | null;
  cost: number | null;
  stock: number | null;
  byType: Record<string, number>;
};

export type MatchedChange = {
  productId: string;
  productName: string;
  patch: Record<string, any>;
  before: { price: number; cost: number; stock: number };
};

export type PricePreview = {
  rows: number;
  changes: MatchedChange[];
  unchanged: number;
  notFound: string[];
  usedColumns: string[];
};

const nrm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/g, "");

function num(s: string): number | null {
  const v = String(s ?? "").replace(/\s|\u00a0/g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; } else q = !q;
    } else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function detectSep(head: string): string {
  const counts: Array<[string, number]> = [
    [";", (head.match(/;/g) ?? []).length],
    ["\t", (head.match(/\t/g) ?? []).length],
    [",", (head.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

const NAME_KEYS = ["наименование", "название", "товар", "номенклатура", "name"];
const SKU_KEYS = ["артикул", "sku", "код", "кодтовара"];
const EXT_KEYS = ["код1с", "id1с", "ext1cid", "идентификатор"];
const PRICE_KEYS = ["цена", "ценапродажи", "розница", "розничная", "price"];
const COST_KEYS = ["закуп", "закупка", "закупочная", "себестоимость", "cost"];
const STOCK_KEYS = ["остаток", "остатки", "количество", "колво", "склад", "qty", "stock"];

/** Разбор файла прайса. */
export function parsePriceFile(text: string, priceTypes: PriceType[]) {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [] as PriceRow[], usedColumns: [] as string[] };
  const sep = detectSep(lines[0]);
  const header = splitLine(lines[0], sep);
  const hk = header.map(nrm);

  const findIdx = (keys: string[]) => hk.findIndex(h => h && keys.some(k => h === k || h.startsWith(k)));
  const iName = findIdx(NAME_KEYS);
  const iSku = findIdx(SKU_KEYS);
  const iExt = findIdx(EXT_KEYS);
  const iPrice = findIdx(PRICE_KEYS);
  const iCost = findIdx(COST_KEYS);
  const iStock = findIdx(STOCK_KEYS);

  // колонки-типы цен
  const typeCols: Array<{ idx: number; typeId: string; label: string }> = [];
  priceTypes.forEach(t => {
    const key = nrm(t.name);
    const idx = hk.findIndex((h, i) => h === key && i !== iName);
    if (idx >= 0) typeCols.push({ idx, typeId: t.id, label: header[idx] });
  });

  const used: string[] = [];
  if (iName >= 0) used.push(header[iName]);
  if (iSku >= 0) used.push(header[iSku]);
  if (iExt >= 0) used.push(header[iExt]);
  if (iPrice >= 0) used.push(header[iPrice]);
  if (iCost >= 0) used.push(header[iCost]);
  if (iStock >= 0) used.push(header[iStock]);
  typeCols.forEach(c => used.push(c.label));

  const rows: PriceRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitLine(line, sep);
    const name = iName >= 0 ? c[iName] ?? "" : "";
    const sku = iSku >= 0 ? c[iSku] ?? "" : "";
    const ext = iExt >= 0 ? c[iExt] ?? "" : "";
    if (!name && !sku && !ext) continue;
    const byType: Record<string, number> = {};
    for (const tc of typeCols) {
      const v = num(c[tc.idx] ?? "");
      if (v != null) byType[tc.typeId] = v;
    }
    rows.push({
      name,
      sku,
      ext,
      price: iPrice >= 0 ? num(c[iPrice] ?? "") : null,
      cost: iCost >= 0 ? num(c[iCost] ?? "") : null,
      stock: iStock >= 0 ? num(c[iStock] ?? "") : null,
      byType,
    });
  }
  return { rows, usedColumns: used };
}

async function loadProducts(wsId: string) {
  const out: any[] = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await (db as any)
      .from("products").select("id,name,sku,ext_1c_id,price,cost,stock,prices")
      .eq("workspace_id", wsId).range(from, from + step - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

export type ImportOptions = {
  updatePrices: boolean;
  updateCost: boolean;
  updateStock: boolean;
  /** Тип цены для колонки «Цена», если она одна. */
  priceTypeId: string | null;
  /** Тип цены, считающийся основным (его значение пишется в поле price). */
  baseTypeId: string | null;
};

/** Сопоставление строк файла с товарами базы и расчёт изменений. */
export async function buildPricePreview(
  rows: PriceRow[],
  wsId: string,
  opts: ImportOptions,
  usedColumns: string[] = [],
): Promise<PricePreview> {
  const products = await loadProducts(wsId);
  const bySku = new Map<string, any>();
  const byExt = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const p of products) {
    const sku = String(p.sku ?? "").trim();
    const ext = String(p.ext_1c_id ?? "").trim();
    const nm = nrm(p.name ?? "");
    if (sku && !bySku.has(sku)) bySku.set(sku, p);
    if (ext && !byExt.has(ext)) byExt.set(ext, p);
    if (nm && !byName.has(nm)) byName.set(nm, p);
  }

  const changes: MatchedChange[] = [];
  const notFound: string[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (const r of rows) {
    const p =
      (r.sku && bySku.get(r.sku.trim())) ||
      (r.ext && byExt.get(r.ext.trim())) ||
      (r.name && byName.get(nrm(r.name))) ||
      null;
    if (!p) { notFound.push(r.name || r.sku || r.ext); continue; }
    if (seen.has(p.id)) continue;

    const patch: Record<string, any> = {};
    const prices: Record<string, number> = { ...((p.prices as any) ?? {}) };
    let pricesTouched = false;

    if (opts.updatePrices) {
      for (const [typeId, v] of Object.entries(r.byType)) {
        if (Number(prices[typeId] ?? NaN) !== v) { prices[typeId] = v; pricesTouched = true; }
      }
      if (r.price != null && opts.priceTypeId) {
        if (Number(prices[opts.priceTypeId] ?? NaN) !== r.price) {
          prices[opts.priceTypeId] = r.price;
          pricesTouched = true;
        }
      }
      if (pricesTouched) patch.prices = prices;
      const base =
        (opts.baseTypeId && prices[opts.baseTypeId] != null ? Number(prices[opts.baseTypeId]) : null) ??
        r.price;
      if (base != null && Number(p.price ?? 0) !== base) patch.price = base;
    }
    if (opts.updateCost && r.cost != null && Number(p.cost ?? 0) !== r.cost) patch.cost = r.cost;
    if (opts.updateStock && r.stock != null && Number(p.stock ?? 0) !== r.stock) patch.stock = r.stock;

    if (!Object.keys(patch).length) { unchanged += 1; continue; }
    seen.add(p.id);
    changes.push({
      productId: p.id,
      productName: p.name,
      patch,
      before: { price: Number(p.price ?? 0), cost: Number(p.cost ?? 0), stock: Number(p.stock ?? 0) },
    });
  }

  return { rows: rows.length, changes, unchanged, notFound, usedColumns };
}

/** Применение изменений к товарам. */
export async function applyPriceChanges(
  changes: MatchedChange[],
  onProgress?: (done: number, total: number) => void,
) {
  const CONCURRENCY = 20;
  for (let i = 0; i < changes.length; i += CONCURRENCY) {
    const part = changes.slice(i, i + CONCURRENCY);
    const res = await Promise.all(
      part.map(c => (db as any).from("products").update(c.patch).eq("id", c.productId)),
    );
    const bad = res.find(r => r.error);
    if (bad?.error) throw new Error(bad.error.message);
    onProgress?.(Math.min(i + CONCURRENCY, changes.length), changes.length);
  }
}
