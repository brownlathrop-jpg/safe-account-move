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
function hasUuidLike(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim();
  return /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(raw) || /[0-9a-fA-F]{32}/.test(raw);
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
  const raw = readNamed(o.refs, names) ?? readNamed(o.props, names);
  if (!raw) return undefined;
  return normalizeExtId(raw) ?? undefined;
}
function readProp(o: Obj, names: string[]): string | undefined {
  return readNamed(o.props, names) ?? readNamed(o.refs, names);
}
function readBool(o: Obj, names: string[]): boolean {
  for (const n of names) if (n in o.bool) return o.bool[n];
  const aliases = names.map(keyOf);
  for (const [key, value] of Object.entries(o.bool)) {
    const normalized = keyOf(key);
    if (aliases.some(alias => normalized === alias || normalized.includes(alias))) return value;
  }
  const v = readNamed(o.props, names);
  return v !== undefined ? boolOf(v) : false;
}
function isInsideTag(el: Element, scope: Element, tag: string): boolean {
  for (let p = el.parentElement; p && p !== scope; p = p.parentElement) {
    if (p.localName === tag || p.tagName === tag) return true;
  }
  return false;
}
function propertyElements(scope: Element): Element[] {
  const direct = childrenByTag(scope, "Свойство");
  const nested = Array.from(scope.getElementsByTagName("Свойство")).filter(p => {
    if (p.parentElement === scope) return false;
    if (isInsideTag(p, scope, "Объект")) return false;
    if (isInsideTag(p, scope, "Ссылка")) return false;
    if ((scope.localName !== "Запись" && scope.tagName !== "Запись") && isInsideTag(p, scope, "ТабличнаяЧасть")) return false;
    return true;
  });
  return [...direct, ...nested];
}
function isKnownStructuralTag(name: string): boolean {
  return ["Ссылка", "Свойство", "ТабличнаяЧасть", "Запись", "Значение", "Объект", "Объекты"].includes(name);
}
function firstIdText(el: Element): string {
  for (const tag of ["Ид", "ID", "Id", "Код", "Идентификатор", "УникальныйИдентификатор"]) {
    const found = firstDescendantByTag(el, tag);
    const value = found?.textContent?.trim();
    if (value) return value;
  }
  return "";
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
  for (const attr of Array.from(ref.attributes)) {
    if (/уникальный.*идентификатор|uuid|guid|\bид\b|\bid\b/i.test(attr.name) && attr.value.trim()) {
      const id = normalizeExtId(attr.value);
      if (id) return id;
    }
  }
  return normalizeExtId(textOf(ref) || ref.textContent || "");
}
function parentObjectRef(el: Element): { ext: string; type: string } | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName !== "Объект" && p.tagName !== "Объект") continue;
    const ext = extIdOfRef(firstChildByTag(p, "Ссылка"));
    const type = p.getAttribute("Тип") || "";
    if (ext) return { ext, type };
  }
  return null;
}
function readProps(scope: Element): Pick<Obj, "props" | "refs" | "num" | "bool"> {
  const props: Record<string, string> = {};
  const refs: Record<string, string> = {};
  const num: Record<string, number> = {};
  const bool: Record<string, boolean> = {};
  for (const attr of Array.from(scope.attributes)) {
    const attrName = attr.name;
    const attrValue = attr.value.trim();
    if (!attrValue) continue;
    if (/булево|boolean/i.test(attr.name) || /это\s*(группа|папка)|is\s*(group|folder)/i.test(attr.name)) {
      bool[attrName] = boolOf(attrValue);
      continue;
    }
    // В некоторых XML 1С ссылка на родителя лежит прямо в атрибуте
    // элемента/ссылки: Родитель="Solo Porte" или Родитель="<uuid>".
    if (/родител|владел|хозяин|parent|owner|папк|folder|категор|раздел/i.test(attrName)) {
      const ref = normalizeExtId(attrValue);
      if (ref) refs[attrName] = ref;
      continue;
    }
    if (!["Тип", "type", "Имя", "name"].includes(attrName) && !(attrName in props)) {
      props[attrName] = attrValue;
    }
  }
  for (const p of propertyElements(scope)) {
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
    if (/Булево|Boolean/i.test(type) || /это\s*(группа|папка)|is\s*(group|folder)/i.test(name)) bool[name] = boolOf(val);
    else if (type === "Число") num[name] = Number(val.replace(",", ".")) || 0;
    else props[name] = val;
  }
  for (let c = scope.firstElementChild; c; c = c.nextElementSibling) {
    const name = c.localName || c.tagName;
    if (!name || isKnownStructuralTag(name)) continue;
    if ((scope.localName !== "Запись" && scope.tagName !== "Запись") && name === "ТабличныеЧасти") continue;

    const link = firstChildByTag(c, "Ссылка") ?? firstDescendantByTag(c, "Ссылка");
    const idText = firstIdText(c);
    const val = textOf(c) || c.textContent?.trim() || "";
    const refValue = link ? extIdOfRef(link) : normalizeExtId(idText || val);

    if (refValue && /родител|групп|папк|folder|parent|категор|раздел/i.test(name)) refs[name] = refValue;
    if (/булево|boolean/i.test(c.getAttribute("Тип") || "") || /это\s*(группа|папка)|is\s*(group|folder)/i.test(name)) bool[name] = boolOf(val);
    else if (val && !(name in props)) props[name] = val;
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
    // В некоторых выгрузках 1С признак папки лежит не в самом объекте,
    // а внутри его <Ссылка> рядом с уникальным идентификатором.
    // Например, папка может выглядеть как обычная номенклатура, но иметь
    // <Ссылка><Свойство Имя="ЭтоГруппа">true</Свойство>...</Ссылка>.
    const fromRef = ref ? readProps(ref) : { props: {}, refs: {}, num: {}, bool: {} };
    const fromObj = readProps(el);
    const xmlParent = parentObjectRef(el);
    const refs = { ...fromRef.refs, ...fromObj.refs };
    // Если в выгрузке 1С папка была раскрыта деревом, дочерние папки/товары
    // могут лежать физически внутри родительского <Объект>, без поля «Родитель».
    if (xmlParent && isNomenclatureType(type) && isNomenclatureType(xmlParent.type) && xmlParent.ext !== ext) {
      refs.__xmlParent = xmlParent.ext;
    }
    out.push({
      type,
      ext,
      props: { ...fromRef.props, ...fromObj.props },
      refs,
      num: { ...fromRef.num, ...fromObj.num },
      bool: { ...fromRef.bool, ...fromObj.bool },
      tables: readTables(el),
    });
  }
  return out;
}

// ---------------------------------------------------------------- импорт
async function batchUpsert(table: string, rows: any[], onConflict = "workspace_id,ext_1c_id", chunk = 200) {
  // Дедупликация по ключу конфликта — иначе Postgres ругается,
  // что одна и та же строка обновляется дважды в одном запросе.
  const keys = onConflict.split(",").map(k => k.trim());
  const seen = new Map<string, any>();
  for (const r of rows) {
    const k = keys.map(kk => String(r?.[kk] ?? "")).join("||");
    seen.set(k, r); // последний выигрывает
  }
  const deduped = Array.from(seen.values());
  for (let i = 0; i < deduped.length; i += chunk) {
    const part = deduped.slice(i, i + chunk);
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

const NOMENCLATURE_PARENT_FIELDS = [
  "__xmlParent", "Родитель", "Parent", "Владелец", "Owner", "Хозяин",
  "Группа", "Папка", "Folder", "Категория", "Раздел",
  "РодительНоменклатуры", "ГруппаНоменклатуры", "НоменклатурнаяГруппа", "КатегорияНоменклатуры",
];
const NOMENCLATURE_GROUP_FLAGS = ["ЭтоГруппа", "Это группа", "IsGroup", "IsFolder", "ЭтоПапка", "Это папка"];
const NOMENCLATURE_PATH_FIELDS = [
  "ПолныйПуть", "Полный путь", "Путь", "Иерархия", "ПутьКПапке", "ПутьКГруппе",
  "ПутьККатегории", "ПутьНоменклатуры", "РодительНаименование", "РодительПредставление",
  "ПолноеНаименование", "Полное наименование", "FullName", "Представление",
];
const NOMENCLATURE_ROOT_FOLDER_NAMES = ["Товары и услуги", "Номенклатура", "Товары", "Услуги"];

function isNomenclatureType(type: string): boolean {
  return /(^|[.\s])Номенклатура($|[.\s])/i.test(type);
}
function typeLooksLikeGroup(type: string): boolean {
  return /(^|[.\s])(Группа|Folder)($|[.\s])/i.test(type) || /Номенклатура.*(Группа|Folder)/i.test(type);
}
function cleanFolderText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^\s*[\\/>|»→:]+\s*|\s*[\\/>|»→:]+\s*$/g, "").trim();
}
function sameText(a: string, b: string): boolean {
  return keyOf(a) === keyOf(b);
}
function splitFolderPath(value: string, itemName?: string): string[] {
  const clean = cleanFolderText(value);
  if (!clean || hasUuidLike(clean)) return [];
  const parts = clean
    .split(/\s*(?:\\|\/|>|»|→|\||::)\s*/g)
    .map(cleanFolderText)
    .filter(Boolean);
  if (parts.length === 0) return [];
  if (itemName && parts.length > 0 && sameText(parts[parts.length - 1], itemName)) parts.pop();
  while (parts.length > 0 && NOMENCLATURE_ROOT_FOLDER_NAMES.some(root => sameText(root, parts[0]))) parts.shift();
  if (parts.length === 1 && itemName && sameText(parts[0], itemName)) return [];
  return parts;
}
function readFolderPathParts(o: Obj, itemName?: string): string[] {
  for (const field of NOMENCLATURE_PATH_FIELDS) {
    const value = readNamed(o.props, [field]);
    if (!value) continue;
    const parts = splitFolderPath(value, itemName);
    if (parts.length > 0) return parts;
  }
  for (const [key, value] of Object.entries(o.props)) {
    const k = keyOf(key);
    if (!k.includes("путь") && !k.includes("иерарх")) continue;
    const parts = splitFolderPath(value, itemName);
    if (parts.length > 0) return parts;
  }
  for (const field of ["ГруппаНоменклатуры", "НоменклатурнаяГруппа", "КатегорияНоменклатуры", "Категория", "Раздел", "Папка", "Группа"]) {
    const value = readNamed(o.props, [field]);
    if (!value) continue;
    const parts = splitFolderPath(value, itemName);
    if (parts.length > 0) return parts;
  }
  return [];
}
function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function folderPathKey(parts: string[]): string {
  return parts.map(p => keyOf(p)).join("/");
}
function folderPathExt(parts: string[]): string {
  const key = folderPathKey(parts);
  return `path:${hashText(key)}:${key.slice(-42)}`;
}
function rememberUnique(map: Map<string, string | null>, key: string, ext: string) {
  if (!key) return;
  const old = map.get(key);
  if (old === undefined) map.set(key, ext);
  else if (old !== ext) map.set(key, null);
}
function copyObj(o: Obj): Obj {
  return {
    type: o.type,
    ext: o.ext,
    props: { ...o.props },
    refs: { ...o.refs },
    bool: { ...o.bool },
    num: { ...o.num },
    tables: { ...o.tables },
  };
}
function mergeObjectsByExt(src: Obj[]): Obj[] {
  const byExt = new Map<string, Obj>();
  const withoutExt: Obj[] = [];

  for (const o of src) {
    if (!o.ext) {
      withoutExt.push(o);
      continue;
    }

    const existing = byExt.get(o.ext);
    if (!existing) {
      byExt.set(o.ext, copyObj(o));
      continue;
    }

    // В XML 1С один и тот же справочник часто встречается несколько раз:
    // один раз как полноценная папка/товар, а потом ещё как короткая ссылка.
    // Нельзя, чтобы короткая ссылка без «Родителя» затирала уже найденную иерархию.
    for (const [key, value] of Object.entries(o.props)) {
      if (value && !existing.props[key]) existing.props[key] = value;
    }
    for (const [key, value] of Object.entries(o.refs)) {
      if (value && !existing.refs[key]) existing.refs[key] = value;
    }
    for (const [key, value] of Object.entries(o.bool)) {
      existing.bool[key] = existing.bool[key] === true || value === true;
    }
    for (const [key, value] of Object.entries(o.num)) {
      if (!(key in existing.num)) existing.num[key] = value;
    }
    for (const [key, value] of Object.entries(o.tables)) {
      if (!existing.tables[key]?.length && value.length) existing.tables[key] = value;
    }
  }

  return [...withoutExt, ...byExt.values()];
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
    const rowsRaw = src.map(o => ({
      ...base, ext_1c_id: o.ext,
      bik: o.props["Код"] || o.props["БИК"] || o.ext!.slice(0, 9),
      name: o.props["Наименование"] || "Банк",
      corr_account: o.props["КоррСчет"] || null,
      city: o.props["Город"] || null,
    }));
    // Дедуп по (workspace_id, bik): в выгрузке 1С встречаются банки с одинаковым БИК
    const seenBik = new Set<string>();
    const rows = rowsRaw.filter(r => {
      const k = `${r.workspace_id}|${r.bik}`;
      if (seenBik.has(k)) return false;
      seenBik.add(k);
      return true;
    });
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const { error } = await (supabase as any)
        .from("banks")
        .upsert(part, { onConflict: "workspace_id,ext_1c_id" });
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
    const src = objs.filter(o => o.ext && isNomenclatureType(o.type));
    // Определяем группы: явный флаг ЭтоГруппа/IsFolder ИЛИ ext, на который ссылается
    // хотя бы один другой объект номенклатуры как на родителя.
    const parentRefs = new Set<string>();
    for (const o of src) {
      const p = readRef(o, NOMENCLATURE_PARENT_FIELDS);
      if (p) parentRefs.add(p);
    }
    const isGroup = (o: Obj) =>
      typeLooksLikeGroup(o.type) || readBool(o, NOMENCLATURE_GROUP_FLAGS) || (o.ext ? parentRefs.has(o.ext) : false);
    const groups = src.filter(isGroup);
    const items  = src.filter(o => !isGroup(o));

    const groupExtSet = new Set(groups.map(g => g.ext!).filter(Boolean));
    const uniqueGroupExtByName = new Map<string, string | null>();
    for (const g of groups) {
      const name = readProp(g, ["Наименование", "НаименованиеПолное"]);
      if (g.ext && name) rememberUnique(uniqueGroupExtByName, keyOf(cleanFolderText(name)), g.ext);
    }

    const realGroupExtByPathKey = new Map<string, string>();
    for (const g of groups) {
      const name = readProp(g, ["Наименование", "НаименованиеПолное"]) || "";
      if (!g.ext || !name) continue;
      const parentParts = readFolderPathParts(g, name);
      realGroupExtByPathKey.set(folderPathKey([...parentParts, name]), g.ext);
    }

    const syntheticFolders = new Map<string, { ext: string; name: string; parentExt: string | null; pathKey: string }>();
    const pathFolderExtByObject = new Map<string, string>();
    const addPathFolders = (parts: string[]): string | null => {
      if (parts.length === 0) return null;
      let parentExt: string | null = null;
      let finalExt: string | null = null;
      for (let i = 1; i <= parts.length; i++) {
        const current = parts.slice(0, i);
        const pathKey = folderPathKey(current);
        const realExt = realGroupExtByPathKey.get(pathKey) ?? null;
        const ext = realExt ?? folderPathExt(current);
        if (!realExt && !syntheticFolders.has(ext)) {
          syntheticFolders.set(ext, {
            ext,
            name: parts[i - 1],
            parentExt,
            pathKey,
          });
        }
        parentExt = ext;
        finalExt = ext;
      }
      return finalExt;
    };

    for (const o of src) {
      const name = readProp(o, ["Наименование", "НаименованиеПолное"]) || "";
      const parts = readFolderPathParts(o, name);
      const ext = addPathFolders(parts);
      if (o.ext && ext) pathFolderExtByObject.set(o.ext, ext);
    }

    const resolveFolderExt = (value: string | undefined, currentExt?: string | null): string | undefined => {
      if (!value) return undefined;
      const clean = cleanFolderText(value);
      if (!clean) return undefined;
      const normalized = normalizeExtId(clean);
      if (normalized && normalized !== currentExt && (groupExtSet.has(normalized) || syntheticFolders.has(normalized))) return normalized;

      const parts = splitFolderPath(clean);
      if (parts.length > 0) {
        const pathKey = folderPathKey(parts);
        const realByPath = realGroupExtByPathKey.get(pathKey);
        if (realByPath && realByPath !== currentExt) return realByPath;
        const syntheticByPath = folderPathExt(parts);
        if (syntheticByPath !== currentExt && syntheticFolders.has(syntheticByPath)) return syntheticByPath;
        const lastByName = uniqueGroupExtByName.get(keyOf(parts[parts.length - 1]));
        if (lastByName && lastByName !== currentExt) return lastByName;
      }

      const byName = uniqueGroupExtByName.get(keyOf(clean));
      return byName && byName !== currentExt ? byName : undefined;
    };

    const readParentFolderExt = (o: Obj): string | undefined => {
      for (const field of NOMENCLATURE_PARENT_FIELDS) {
        const raw = readNamed(o.refs, [field]) ?? readNamed(o.props, [field]);
        const ext = resolveFolderExt(raw, o.ext);
        if (ext) return ext;
      }
      return undefined;
    };

    // 8a. папки
    const folderRows = groups.map(o => ({
      ...base, ext_1c_id: o.ext,
      name: readProp(o, ["Наименование", "НаименованиеПолное"]) || "Папка",
    })).concat(Array.from(syntheticFolders.values()).map(f => ({
      ...base, ext_1c_id: f.ext,
      name: f.name || "Папка",
    })));
    onProgress("Папки номенклатуры", 0, folderRows.length, `из объектов: ${groups.length}, из путей: ${syntheticFolders.size}`);
    await batchUpsert("product_folders", folderRows);
    // parent
    const fmap = await loadExtMap("product_folders", wsId);
    const findParentForGroup = (o: Obj): string | undefined => {
      // 1) явное поле «Родитель/Владелец/…»
      const explicit = readParentFolderExt(o);
      if (explicit) return explicit;
      // 2) любая ссылка, ведущая на другую известную папку
      for (const v of Object.values(o.refs)) {
        const norm = resolveFolderExt(v, o.ext);
        if (norm) return norm;
      }
      return undefined;
    };
    for (const o of groups) {
      const pathExt = pathFolderExtByObject.get(o.ext!);
      const pExt = findParentForGroup(o)
        ?? pathExt
        ?? undefined;
      const id = fmap.get(o.ext!);
      const parent = pExt ? fmap.get(pExt) : null;
      if (id) await (supabase as any).from("product_folders").update({ parent_id: parent ?? null }).eq("id", id);
    }
    for (const f of syntheticFolders.values()) {
      const id = fmap.get(f.ext);
      const parent = f.parentExt ? fmap.get(f.parentExt) : null;
      if (id) await (supabase as any).from("product_folders").update({ parent_id: parent }).eq("id", id);
    }
    const foldersWithParent = groups.filter(o => findParentForGroup(o) || pathFolderExtByObject.get(o.ext!)).length
      + Array.from(syntheticFolders.values()).filter(f => f.parentExt).length;
    const rootFolders = Math.max(0, folderRows.length - foldersWithParent);
    onProgress("Папки номенклатуры", folderRows.length, folderRows.length, `из объектов: ${groups.length}, из путей: ${syntheticFolders.size}, с родителем: ${foldersWithParent}, верхний уровень: ${rootFolders}`);

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
        const parentExt = readParentFolderExt(o);
        const pathExt = pathFolderExtByObject.get(o.ext!);
        const folderId = parentExt && fmap.has(parentExt)
          ? fmap.get(parentExt)!
          : pathExt && fmap.has(pathExt)
            ? fmap.get(pathExt)!
            : null;
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
