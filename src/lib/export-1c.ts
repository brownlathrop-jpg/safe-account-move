// Выгрузка товаров обратно в 1С: CommerceML 2.04 (import.xml + offers.xml в одном файле)
// и простой прайс в CSV для Excel.

import { db } from "@/integrations/db";
import type { PriceType } from "@/lib/price-types";

type Prod = {
  id: string;
  name: string;
  sku: string | null;
  ext_1c_id: string | null;
  unit: string | null;
  price: number | null;
  cost: number | null;
  stock: number | null;
  prices: Record<string, number> | null;
  folder_id: string | null;
  kind?: string | null;
};

type Folder = { id: string; name: string; parent_id: string | null };

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function loadAll(table: string, select: string, wsId: string) {
  const out: any[] = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await (db as any)
      .from(table).select(select).eq("workspace_id", wsId).range(from, from + step - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

export async function loadExportData(wsId: string) {
  const [products, folders] = await Promise.all([
    loadAll("products", "id,name,sku,ext_1c_id,unit,price,cost,stock,prices,folder_id,kind", wsId) as Promise<Prod[]>,
    loadAll("product_folders", "id,name,parent_id", wsId) as Promise<Folder[]>,
  ]);
  return { products, folders };
}

function groupsXml(folders: Folder[], parent: string | null, indent: string): string {
  const kids = folders.filter(f => (f.parent_id ?? null) === parent);
  if (!kids.length) return "";
  return (
    `${indent}<Группы>\n` +
    kids
      .map(f => {
        const inner = groupsXml(folders, f.id, indent + "    ");
        return (
          `${indent}  <Группа>\n` +
          `${indent}    <Ид>${esc(f.id)}</Ид>\n` +
          `${indent}    <Наименование>${esc(f.name)}</Наименование>\n` +
          inner +
          `${indent}  </Группа>\n`
        );
      })
      .join("") +
    `${indent}</Группы>\n`
  );
}

/** CommerceML 2.04: каталог товаров + пакет предложений с ценами и остатками. */
export function buildCommerceMl(
  products: Prod[],
  folders: Folder[],
  priceTypes: PriceType[],
  orgName: string,
): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const date = now.slice(0, 10);
  const time = now.slice(11);

  const goods = products
    .map(p => {
      const id = p.ext_1c_id || p.id;
      return (
        `        <Товар>\n` +
        `          <Ид>${esc(id)}</Ид>\n` +
        (p.sku ? `          <Артикул>${esc(p.sku)}</Артикул>\n` : "") +
        `          <Наименование>${esc(p.name)}</Наименование>\n` +
        `          <БазоваяЕдиница Код="796" НаименованиеПолное="${esc(p.unit || "шт")}">${esc(p.unit || "шт")}</БазоваяЕдиница>\n` +
        (p.folder_id ? `          <Группы><Ид>${esc(p.folder_id)}</Ид></Группы>\n` : "") +
        `        </Товар>\n`
      );
    })
    .join("");

  const priceTypesXml = priceTypes
    .map(
      t =>
        `        <ТипЦены>\n` +
        `          <Ид>${esc(t.id)}</Ид>\n` +
        `          <Наименование>${esc(t.name)}</Наименование>\n` +
        `          <Валюта>${esc(t.currency || "RUB")}</Валюта>\n` +
        `        </ТипЦены>\n`,
    )
    .join("");

  const offers = products
    .map(p => {
      const id = p.ext_1c_id || p.id;
      const map = p.prices ?? {};
      const list = priceTypes
        .map(t => {
          const v = map?.[t.id];
          const value = v != null ? Number(v) : t.is_default ? Number(p.price ?? 0) : null;
          if (value == null) return "";
          return (
            `            <Цена>\n` +
            `              <ИдТипаЦены>${esc(t.id)}</ИдТипаЦены>\n` +
            `              <ЦенаЗаЕдиницу>${value.toFixed(2)}</ЦенаЗаЕдиницу>\n` +
            `              <Валюта>${esc(t.currency || "RUB")}</Валюта>\n` +
            `              <Единица>${esc(p.unit || "шт")}</Единица>\n` +
            `            </Цена>\n`
          );
        })
        .join("");
      return (
        `        <Предложение>\n` +
        `          <Ид>${esc(id)}</Ид>\n` +
        `          <Наименование>${esc(p.name)}</Наименование>\n` +
        (list ? `          <Цены>\n${list}          </Цены>\n` : "") +
        `          <Количество>${Number(p.stock ?? 0)}</Количество>\n` +
        `        </Предложение>\n`
      );
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<КоммерческаяИнформация ВерсияСхемы="2.04" ДатаФормирования="${date}">\n` +
    `  <Каталог СодержитТолькоИзменения="false">\n` +
    `    <Ид>${esc("catalog-" + date)}</Ид>\n` +
    `    <Наименование>Каталог товаров</Наименование>\n` +
    `    <Владелец><Ид>owner</Ид><Наименование>${esc(orgName || "КабинетCRM")}</Наименование></Владелец>\n` +
    groupsXml(folders, null, "    ") +
    `    <Товары>\n${goods}    </Товары>\n` +
    `  </Каталог>\n` +
    `  <ПакетПредложений>\n` +
    `    <Ид>offers-${date}</Ид>\n` +
    `    <Наименование>Цены и остатки</Наименование>\n` +
    `    <ДатаФормирования>${date}</ДатаФормирования>\n` +
    `    <Время>${time}</Время>\n` +
    (priceTypesXml ? `    <ТипыЦен>\n${priceTypesXml}    </ТипыЦен>\n` : "") +
    `    <Предложения>\n${offers}    </Предложения>\n` +
    `  </ПакетПредложений>\n` +
    `</КоммерческаяИнформация>\n`
  );
}

/** Прайс в CSV: наименование, артикул, код 1С, единица, остаток, цены по типам. */
export function buildPriceCsv(products: Prod[], priceTypes: PriceType[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Наименование", "Артикул", "Код 1С", "Единица", "Остаток", "Цена", "Закуп", ...priceTypes.map(t => t.name)];
  const lines = [head.map(cell).join(";")];
  for (const p of products) {
    const map = p.prices ?? {};
    lines.push(
      [
        p.name,
        p.sku ?? "",
        p.ext_1c_id ?? "",
        p.unit ?? "шт",
        Number(p.stock ?? 0),
        Number(p.price ?? 0),
        Number(p.cost ?? 0),
        ...priceTypes.map(t => (map?.[t.id] != null ? Number(map[t.id]) : "")),
      ].map(cell).join(";"),
    );
  }
  return "\uFEFF" + lines.join("\r\n");
}

export function downloadText(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
