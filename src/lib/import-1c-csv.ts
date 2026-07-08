// Импорт CSV-выгрузки товаров из «Большой Птицы».
// Формат: 20 колонок через `;`, кодировка UTF-8 (может быть BOM).
// Колонки, которые используем:
//   1  — папка (одноуровневая, может быть пустой)
//   2  — наименование товара
//   10 — единица (например "шт")
//   18 — оптовая/закупочная цена (может быть пусто)
//   20 — розничная цена (может быть пусто)
// Задача: починить у товаров привязку к папке и цены, где они были пусты
// после XML-импорта, и добавить те товары, которых в базе ещё нет.

import { supabase } from "@/integrations/supabase/client";
import type { ProgressCb } from "@/lib/import-1c";

type Row = { folder: string; name: string; unit: string; cost: number; price: number };

function parseNum(s: string): number {
  const v = (s || "").replace(/\s/g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseProductCsv(text: string): Row[] {
  // Убираем BOM, если есть
  const clean = text.replace(/^\uFEFF/, "");
  const out: Row[] = [];
  for (const raw of clean.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split(";");
    if (cols.length < 2) continue;
    const name = (cols[1] || "").trim();
    if (!name) continue;
    out.push({
      folder: (cols[0] || "").trim(),
      name,
      unit: (cols[9] || "шт").trim() || "шт",
      cost: parseNum(cols[17] || ""),
      price: parseNum(cols[19] || ""),
    });
  }
  return out;
}

async function loadAll(table: string, select: string, wsId: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from(table).select(select).eq("workspace_id", wsId).range(from, from + step - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

export async function importProductsCsv(
  csvText: string,
  wsId: string,
  userId: string,
  onProgress: ProgressCb,
) {
  onProgress("CSV: разбор", 0, 1);
  const rows = parseProductCsv(csvText);
  onProgress("CSV: разбор", 1, 1, `строк: ${rows.length}`);

  // 1) Папки — по имени (одноуровневые, parent_id = null)
  const folderNames = Array.from(new Set(rows.map(r => r.folder).filter(Boolean)));
  onProgress("CSV: папки", 0, folderNames.length);

  const existingFolders = await loadAll("product_folders", "id,name,parent_id", wsId);
  const folderIdByName = new Map<string, string>();
  for (const f of existingFolders) {
    // приоритет — папке верхнего уровня; если есть только вложенная, тоже возьмём
    const key = String(f.name || "").trim();
    if (!key) continue;
    if (f.parent_id == null || !folderIdByName.has(key)) folderIdByName.set(key, f.id);
  }

  const toInsertFolders = folderNames
    .filter(n => !folderIdByName.has(n))
    .map(name => ({ workspace_id: wsId, user_id: userId, name, parent_id: null }));
  if (toInsertFolders.length) {
    for (let i = 0; i < toInsertFolders.length; i += 200) {
      const part = toInsertFolders.slice(i, i + 200);
      const { data, error } = await (supabase as any)
        .from("product_folders").insert(part).select("id,name");
      if (error) throw new Error(`product_folders: ${error.message}`);
      for (const f of data ?? []) folderIdByName.set(String(f.name).trim(), f.id);
    }
  }
  onProgress("CSV: папки", folderNames.length, folderNames.length,
    `новых: ${toInsertFolders.length}, всего: ${folderNames.length}`);

  // 2) Товары — сравниваем по имени
  const existingProducts = await loadAll("products", "id,name,folder_id,price,cost,unit", wsId);
  const prodByName = new Map<string, any>();
  for (const p of existingProducts) {
    const k = String(p.name || "").trim();
    if (k && !prodByName.has(k)) prodByName.set(k, p);
  }

  onProgress("CSV: товары", 0, rows.length);
  let updated = 0, inserted = 0, folderFixed = 0, priceFixed = 0;
  const toInsert: any[] = [];
  const updates: Array<{ id: string; patch: any }> = [];

  for (const r of rows) {
    const folderId = r.folder ? (folderIdByName.get(r.folder) ?? null) : null;
    const existing = prodByName.get(r.name);
    if (existing) {
      const patch: any = {};
      if (folderId && existing.folder_id !== folderId) { patch.folder_id = folderId; folderFixed += 1; }
      if (r.price > 0 && Number(existing.price || 0) === 0) { patch.price = r.price; priceFixed += 1; }
      if (r.cost > 0 && Number(existing.cost || 0) === 0) patch.cost = r.cost;
      if (r.unit && !existing.unit) patch.unit = r.unit;
      if (Object.keys(patch).length) { updates.push({ id: existing.id, patch }); updated += 1; }
    } else {
      toInsert.push({
        workspace_id: wsId, user_id: userId,
        name: r.name, unit: r.unit || "шт",
        price: r.price, cost: r.cost,
        kind: "product",
        folder_id: folderId,
      });
    }
  }

  // Апдейты — по одному, но батчами прогресса
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const { error } = await (supabase as any).from("products").update(u.patch).eq("id", u.id);
    if (error) throw new Error(`products update: ${error.message}`);
    if (i % 50 === 0 || i === updates.length - 1) {
      onProgress("CSV: товары", i + 1, rows.length,
        `обновлено: ${updated}, папок исправлено: ${folderFixed}, цен добавлено: ${priceFixed}`);
    }
  }

  // Вставки — батчами
  for (let i = 0; i < toInsert.length; i += 200) {
    const part = toInsert.slice(i, i + 200);
    const { error } = await (supabase as any).from("products").insert(part);
    if (error) throw new Error(`products insert: ${error.message}`);
    inserted += part.length;
  }

  onProgress("CSV: готово", rows.length, rows.length,
    `обновлено: ${updated}, добавлено: ${inserted}, папок исправлено: ${folderFixed}, цен добавлено: ${priceFixed}`);
}
