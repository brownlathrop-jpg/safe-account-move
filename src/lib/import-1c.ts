// Парсер и импорт справочников из выгрузки 1С (правила КонвертацииДанных 2.0).
// Работает целиком в браузере: XML → DOMParser → пакетные upsert в Supabase.

import { supabase } from "@/integrations/supabase/client";

export type ProgressCb = (stage: string, done: number, total: number, note?: string) => void;

type Obj = {
  type: string;               // «СправочникСсылка.Контрагенты»
  ext: string | null;         // {УникальныйИдентификатор}
  props: Record<string, string>;   // строковые поля
  refs: Record<string, string>;    // ссылки → чужой ext id
  bool: Record<string, boolean>;
  num: Record<string, number>;
  tables: Record<string, Row[]>;
};
type Row = { props: Record<string, string>; refs: Record<string, string>; num: Record<string, number>; bool: Record<string, boolean> };

// ---------------------------------------------------------------- парсер
function childrenByTag(el: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === tag || c.tagName === tag) out.push(c);
  }
  return out;
}
function firstChildByTag(el: Element, tag: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === tag || c.tagName === tag) return c;
  }
  return null;
}
function textOf(el: Element | null): string {
  if (!el) return "";
  const v = firstChildByTag(el, "Значение");
  return (v?.textContent ?? el.textContent ?? "").trim();
}
function firstDescendantByTag(el: Element, tag: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === tag || c.tagName === tag) return c;
    const nested = firstDescendantByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}
function normalizeExtId(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const uuid = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuid) return uuid[0];
  const compact = raw.match(/[0-9a-fA-F]{32}/);
  return compact ? compact[0] : raw;
}
function boolOf(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "истина" || v === "да" || v === "1";
}
function keyOf(name: string): string {
  return name.replace(/[{}\s_-]/g, "").toLowerCase();
}
function readNamed(record: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    if (record[name]) return record[name];
  }
  const aliases = names.map(keyOf);
  for (const [key, value] of Object.entries(record)) {
    const normalized = keyOf(key);
    if (aliases.some(alias => normalized === alias || normalized.includes(alias))) return value;
  }
  return undefined;
}
function readRef(o: Obj, names: string[]): string | undefined {
  return readNamed(o.refs, names) ?? readNamed(o.props, names);
}
function readProp(o: Obj, names: string[]): string | undefined {
  return readNamed(o.props, names) ?? readNamed(o.refs, names);
}
function extIdOfRef(ref: Element | null): string | null {
  if (!ref) return null;
  for (const p of childrenByTag(ref, "Свойство")) {
    if (p.getAttribute("Имя") === "{УникальныйИдентификатор}") return normalizeExtId(textOf(p));
  }
  const nestedUid = Array.from(ref.getElementsByTagName("Свойство")).find(
    p => p.getAttribute("Имя") === "{УникальныйИдентификатор}",
  );
  if (nestedUid) return normalizeExtId(textOf(nestedUid));
  return normalizeExtId(textOf(ref) || ref.textContent || "");
}
function readProps(scope: Element): Pick<Obj, "props" | "refs" | "num" | "bool"> {
  const props: Record<string, string> = {};
  const refs: Record<string, string> = {};
  const num: Record<string, number> = {};
  const bool: Record<string, boolean> = {};
  for (const p of childrenByTag(scope, "Свойство")) {
    const name = p.getAttribute("Имя") || "";
    const type = p.getAttribute("Тип") || "";
    if (!name) continue;
    const link = firstChildByTag(p, "Ссылка") ?? firstDescendantByTag(p, "Ссылка");
    const val = textOf(p);
    if (link) {
      const id = extIdOfRef(link);
      if (id) refs[name] = id;
      continue;
    }
    if (/Ссылка/i.test(type)) {
      const id = normalizeExtId(val || p.textContent || "");
      if (id) refs[name] = id;
      continue;
    }
    if (type === "Булево" || name === "ЭтоГруппа") bool[name] = boolOf(val);
    else if (type === "Число") num[name] = Number(val.replace(",", ".")) || 0;
    else props[name] = val;
  }
  return { props, refs, num, bool };
}
function readTables(objEl: Element): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const t of childrenByTag(objEl, "ТабличнаяЧасть")) {
    const name = t.getAttribute("Имя") || "";
    const rows: Row[] = [];
    for (const r of childrenByTag(t, "Запись")) {
      rows.push(readProps(r));
    }
    out[name] = rows;
  }
  return out;
}

export function parseAllObjects(xml: string): Obj[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Ошибка чтения XML: " + err.textContent);
  const out: Obj[] = [];
  for (const el of Array.from(doc.getElementsByTagName("Объект"))) {
    const type = el.getAttribute("Тип") || "";
    const ref = firstChildByTag(el, "Ссылка");
    const ext = extIdOfRef(ref);
    const { props, refs, num, bool } = readProps(el);
    out.push({ type, ext, props, refs, num, bool, tables: readTables(el) });
  }
  return out;
}

// ---------------------------------------------------------------- импорт
async function batchUpsert(table: string, rows: any[], onConflict = "workspace_id,ext_1c_id", chunk = 200) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { error } = await (supabase as any).from(table).upsert(part, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function loadExtMap(table: string, wsId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await (supabase as any).from(table)
      .select("id,ext_1c_id").eq("workspace_id", wsId)
      .not("ext_1c_id", "is", null)
      .range(from, from + step - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.ext_1c_id) map.set(r.ext_1c_id, r.id);
    if (data.length < step) break;
    from += step;
  }
  return map;
}

export async function importAll(
  xml: string,
  wsId: string,
  userId: string,
  onProgress: ProgressCb,
) {
  onProgress("Разбор XML", 0, 1);
  const objs = parseAllObjects(xml);
  onProgress("Разбор XML", 1, 1, `объектов: ${objs.length}`);

  const byType = new Map<string, Obj[]>();
  for (const o of objs) {
    if (!o.ext) continue;
    const arr = byType.get(o.type) ?? [];
    arr.push(o);
    byType.set(o.type, arr);
  }

  const base = { user_id: userId, workspace_id: wsId };

  // 1. Склады
  {
    const src = byType.get("СправочникСсылка.Склады") ?? [];
    onProgress("Склады", 0, src.length);
    const rows = src.map(o => ({ ...base, ext_1c_id: o.ext, name: o.props["Наименование"] || "Склад", is_default: false }));
    await batchUpsert("warehouses", rows);
    onProgress("Склады", rows.length, rows.length);
  }

  // 2. Виды номенклатуры
  {
    const src = byType.get("СправочникСсылка.ВидыНоменклатуры") ?? [];
    onProgress("Виды номенклатуры", 0, src.length);
    const rows = src.map(o => ({
      ...base, ext_1c_id: o.ext,
      name: o.props["Наименование"] || "Вид",
      is_service: /услуг/i.test(o.props["Наименование"] || ""),
    }));
    await batchUpsert("product_types", rows);
    onProgress("Виды номенклатуры", rows.length, rows.length);
  }

  // 3. Типы цен
  {
    const src = byType.get("СправочникСсылка.ТипыЦенНоменклатуры") ?? [];
    onProgress("Типы цен", 0, src.length);
    const rows = src.map(o => ({
      ...base, ext_1c_id: o.ext,
      name: o.props["Наименование"] || "Тип цены",
      currency: "RUB", is_default: false,
    }));
    await batchUpsert("price_types", rows);
    onProgress("Типы цен", rows.length, rows.length);
  }

  // 4. Статьи ДДС
  {
    const src = byType.get("СправочникСсылка.СтатьиДвиженияДенежныхСредств") ?? [];
    onProgress("Статьи ДДС", 0, src.length);
    const rows = src.map(o => ({
      ...base, ext_1c_id: o.ext,
      name: o.props["Наименование"] || "Статья",
      direction: "both",
    }));
    await batchUpsert("cashflow_items", rows);
    onProgress("Статьи ДДС", rows.length, rows.length);
  }

  // 5. Банки
  {
    const src = byType.get("СправочникСсылка.Банки") ?? [];
    onProgress("Банки", 0, src.length);
    const rows = src.map(o => ({
      ...base, ext_1c_id: o.ext,
      bik: o.props["Код"] || o.props["БИК"] || o.ext!.slice(0, 9),
      name: o.props["Наименование"] || "Банк",
      corr_account: o.props["КоррСчет"] || null,
      city: o.props["Город"] || null,
    }));
    // banks has UNIQUE (workspace_id, bik) — предпочтём этот ключ
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const { error } = await (supabase as any).from("banks").upsert(part, { onConflict: "workspace_id,bik" });
      if (error) throw new Error("banks: " + error.message);
    }
    onProgress("Банки", rows.length, rows.length);
  }

  // 6. Контрагенты (в два прохода: сначала все, потом parent_id)
  const partnerRawByExt = new Map<string, Obj>();
  {
    const src = byType.get("СправочникСсылка.Контрагенты") ?? [];
    for (const o of src) partnerRawByExt.set(o.ext!, o);
    onProgress("Контрагенты", 0, src.length);
    const rows = src.map(o => {
      const isGroup = o.bool["ЭтоГруппа"] === true;
      const isCust = /покуп|клиент/i.test((o.props["Наименование"] || "") + " " + (o.props["Комментарий"] || ""));
      return {
        ...base, ext_1c_id: o.ext,
        name: o.props["Наименование"] || "Без имени",
        full_name: o.props["НаименованиеПолное"] || null,
        inn: o.props["ИНН"] || null,
        kpp: o.props["КПП"] || null,
        okpo: o.props["КодПоОКПО"] || null,
        entity_type: o.props["ЮридическоеФизическоеЛицо"] === "ФизическоеЛицо" ? "individual" : "legal",
        is_group: isGroup,
        kind: isCust ? "customer" : "supplier",
        comment: o.props["Комментарий"] || null,
      };
    });
    await batchUpsert("partners", rows);
    onProgress("Контрагенты", rows.length, rows.length);

    // parent_id
    const map = await loadExtMap("partners", wsId);
    const parentPatches: any[] = [];
    for (const o of src) {
      const pExt = o.refs["Родитель"];
      if (!pExt) continue;
      const id = map.get(o.ext!);
      const parentId = map.get(pExt);
      if (id && parentId) parentPatches.push({ id, parent_id: parentId });
    }
    for (const p of parentPatches) {
      await (supabase as any).from("partners").update({ parent_id: p.parent_id }).eq("id", p.id);
    }
    onProgress("Контрагенты (родители)", parentPatches.length, parentPatches.length);
  }

  // 7. Банковские счета — привязка к контрагенту/организации
  {
    const src = byType.get("СправочникСсылка.БанковскиеСчета") ?? [];
    onProgress("Банковские счета", 0, src.length);
    const partnersMap = await loadExtMap("partners", wsId);
    const banksMap = await loadExtMap("banks", wsId);
    // organization: возьмём главную из workspace
    const { data: org } = await (supabase as any).from("organizations")
      .select("id").eq("workspace_id", wsId).order("is_primary", { ascending: false }).limit(1).maybeSingle();
    const orgId = org?.id ?? null;

    const rows: any[] = [];
    for (const o of src) {
      const ownerExt = o.refs["Владелец"];
      const bankExt = o.refs["Банк"];
      const bankId = bankExt ? banksMap.get(bankExt) ?? null : null;
      const account = o.props["НомерСчета"] || "";
      if (!ownerExt || !account) continue;
      const partnerId = partnersMap.get(ownerExt);
      if (partnerId) {
        rows.push({ ...base, ext_1c_id: o.ext, owner_type: "partner", partner_id: partnerId, bank_id: bankId, account_number: account, currency: "RUB", is_primary: false });
      } else if (orgId) {
        rows.push({ ...base, ext_1c_id: o.ext, owner_type: "organization", organization_id: orgId, bank_id: bankId, account_number: account, currency: "RUB", is_primary: false });
      }
    }
    await batchUpsert("bank_accounts", rows);
    onProgress("Банковские счета", rows.length, rows.length);
  }

  // 8. Номенклатура: сначала все папки, потом товары
  {
    const src = byType.get("СправочникСсылка.Номенклатура") ?? [];
    const groups = src.filter(o => o.bool["ЭтоГруппа"] === true);
    const items  = src.filter(o => o.bool["ЭтоГруппа"] !== true);

    // 8a. папки
    onProgress("Папки номенклатуры", 0, groups.length);
    const folderRows = groups.map(o => ({
      ...base, ext_1c_id: o.ext,
      name: readProp(o, ["Наименование", "НаименованиеПолное"]) || "Папка",
    }));
    await batchUpsert("product_folders", folderRows);
    // parent
    const fmap = await loadExtMap("product_folders", wsId);
    for (const o of groups) {
      const pExt = readRef(o, ["Родитель", "Группа", "Папка", "РодительНоменклатуры"]);
      const id = fmap.get(o.ext!);
      const parent = pExt ? fmap.get(pExt) : null;
      if (id && parent) await (supabase as any).from("product_folders").update({ parent_id: parent }).eq("id", id);
    }
    onProgress("Папки номенклатуры", groups.length, groups.length);

    // 8b. товары
    const ptMap = await loadExtMap("product_types", wsId);
    onProgress("Товары", 0, items.length);
    const total = items.length;
    let done = 0;
    let withParent = 0;
    let withFolder = 0;
    const chunk = 200;
    for (let i = 0; i < total; i += chunk) {
      const part = items.slice(i, i + chunk).map(o => {
        const ptExt = readRef(o, ["ВидНоменклатуры"]);
        const ptId = ptExt ? ptMap.get(ptExt) : null;
        const name = readProp(o, ["Наименование", "НаименованиеПолное"]) || "Товар";
        const isService = /услуг/i.test(name);
        const parentExt = readRef(o, ["Родитель", "Группа", "Папка", "РодительНоменклатуры"]);
        const folderId = parentExt ? fmap.get(parentExt) ?? null : null;
        if (parentExt) withParent += 1;
        if (folderId) withFolder += 1;
        return {
          ...base, ext_1c_id: o.ext,
          name,
          unit: o.props["ЕдиницаХраненияОстатков"] || "шт",
          price: 0, cost: 0,
          kind: isService ? "service" : "product",
          is_service: isService,
          product_type_id: ptId,
          folder_id: folderId,
        };
      });
      const { error } = await (supabase as any).from("products").upsert(part, { onConflict: "workspace_id,ext_1c_id" });
      if (error) throw new Error("products: " + error.message);
      done += part.length;
      onProgress("Товары", done, total, `с родителем: ${withParent}, с папкой: ${withFolder}`);
    }
  }

  onProgress("Готово", 1, 1);
}
