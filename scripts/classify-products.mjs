/**
 * Раскладывает все товары по папкам: Производитель -> Тип изделия.
 * Что не распознано — в папку «Разобрать».
 * Запуск:  bun scripts/classify-products.mjs [--apply]
 */
import { cert } from "firebase-admin/app";
import { createHash } from "crypto";
const fid = (s) => {
  const h = createHash("sha1").update(s).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
};

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const PROJECT = svc.project_id;
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCPATH = `projects/${PROJECT}/databases/(default)/documents`;
const token = async () => (await credential.getAccessToken()).access_token;
const APPLY = process.argv.includes("--apply");
const CACHE = "/tmp/classify-cache.json";

// \b не работает с кириллицей — свои границы слова
const L = "A-Za-zА-Яа-яЁё0-9";
const w = (body) => new RegExp(`(?:^|[^${L}])(?:${body})(?![${L}])`, "i");

const BRANDS = [
  ["Solo Porte", /solo\s*porte/i],
  ["Uberture", /uberture/i],
  ["Дера", w("дера")],
  ["Дубрава", /дубрава/i],
  ["Матадор", /матадор/i],
  ["ВДК", w("вдк")],
  ["ВФД", w("вфд")],
  ["Собрание", /собрание/i],
  ["Foret Light", /foret\s*light/i],
  ["Foret", w("foret")],
  ["Lidman", /lidman/i],
  ["Casa Porte", /casa\s*porte/i],
  ["Avanzati", /avanzati/i],
  ["La Stella", /la\s*stella|lastella/i],
  ["Легро", /легро/i],
  ["Миракс", /миракс/i],
  ["Тренто", /тренто/i],
  ["Верда", /верда/i],
  ["Биланчино", /биланчино/i],
  ["ElDorf", /eldorf/i],
  ["Prizma", /prizma/i],
  ["Сварог", /сварог/i],
  ["Bussare", /bussare/i],
  ["Маяк", w("маяк")],
];

const TYPES = [
  ["Доборы", /добор/i],
  ["Наличники", /наличник/i],
  ["Короба", /\bкороб/i],
  ["Погонаж", /погонаж|стоевая|уплотнител/i],
  ["Двери", /^\s*(ДП|ДО|ДГ|ПГ|ПО|Д[ПОГ])[\s.]|дверь|полотно|дверное/i],
];

const FURNITURE = /ручк|замок|замк|защелк|петл|цилиндр|накладка на цилиндр|фиксатор|доводчик|упор|шпингалет|крючок|порог|завертк|ответная планка|apecs|ajax|бордер|code deco/i;

const fromValue = (v) => {
  if (!v || "nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  return null;
};
const toValue = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
};

async function listAll(table) {
  const out = [];
  let pageToken = "";
  do {
    const url = new URL(`${REST}/${table}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let res, tries = 0;
    for (;;) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
      if (res.ok) break;
      if (++tries > 15) throw new Error(`${table}: ${res.status}`);
      await new Promise((r) => setTimeout(r, Math.min(tries * 8000, 60000)));
    }
    const data = await res.json();
    for (const d of data.documents ?? []) {
      const row = { id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields ?? {})) row[k] = fromValue(v);
      out.push(row);
    }
    pageToken = data.nextPageToken ?? "";
    process.stderr.write(`\r${table}: ${out.length}   `);
  } while (pageToken);
  process.stderr.write("\n");
  return out;
}

async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    let tries = 0;
    for (;;) {
      const res = await fetch(`${REST}:commit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
      });
      if (res.ok) break;
      if (++tries > 10) throw new Error(`commit ${res.status} ${(await res.text()).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, Math.min(tries * 8000, 60000)));
    }
    process.stderr.write(`\rзаписано ${Math.min(i + 400, writes.length)}/${writes.length}   `);
  }
  process.stderr.write("\n");
}

let cache = null;
try { cache = JSON.parse(await Bun.file(CACHE).text()); } catch {}
if (!cache) {
  const products = JSON.parse(await Bun.file("/tmp/products.json").text());
  cache = { products, folders: [] }; // чтение базы исчерпало квоту — папки создаём заново
  await Bun.write(CACHE, JSON.stringify(cache));
}
const { products, folders } = cache;

function classify(p) {
  const name = p.name ?? "";
  if (p.kind === "service" || p.is_service) return ["Услуги", null];
  if (FURNITURE.test(name)) {
    const t = TYPES.find(([, re]) => re.test(name));
    return ["Фурнитура", t && t[0] !== "Двери" ? t[0] : null];
  }
  const brand = BRANDS.find(([, re]) => re.test(name));
  const type = TYPES.find(([, re]) => re.test(name));
  if (brand) return [brand[0], type ? type[0] : "Прочее"];
  if (type) return [type[0], null];
  return ["Разобрать", null];
}

const writes = [];
const stat = new Map();
const byWs = new Map();
for (const p of products) {
  const a = byWs.get(p.workspace_id) ?? [];
  a.push(p);
  byWs.set(p.workspace_id, a);
}

for (const [wsId, list] of byWs) {
  const userId = list[0]?.user_id;
  const wsFolders = folders.filter((f) => f.workspace_id === wsId);
  const key = (name, parent) => `${parent ?? ""}|${(name ?? "").trim().toLowerCase()}`;
  const index = new Map(wsFolders.map((f) => [key(f.name, f.parent_id), f]));

  const ensure = (name, parentId) => {
    const k = key(name, parentId);
    const hit = index.get(k);
    if (hit) return hit;
    const now = new Date().toISOString();
    const f = { id: fid(`${wsId}|${parentId ?? ""}|${name}`), name, parent_id: parentId ?? null, workspace_id: wsId, user_id: userId, created_at: now, updated_at: now };
    index.set(k, f);
    writes.push({ update: { name: `${DOCPATH}/product_folders/${f.id}`, fields: Object.fromEntries(Object.entries(f).map(([k2, v]) => [k2, toValue(v)])) } });
    return f;
  };

  for (const p of list) {
    const [root, sub] = classify(p);
    const rootFolder = ensure(root, null);
    const target = sub ? ensure(sub, rootFolder.id) : rootFolder;
    const label = sub ? `${root} / ${sub}` : root;
    stat.set(label, (stat.get(label) ?? 0) + 1);
    if (p.folder_id === target.id) continue;
    writes.push({
      update: { name: `${DOCPATH}/products/${p.id}`, fields: { folder_id: toValue(target.id), updated_at: toValue(new Date().toISOString()) } },
      updateMask: { fieldPaths: ["folder_id", "updated_at"] },
    });
  }
}

for (const [k, v] of [...stat].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(5)}  ${k}`);
console.log(`\nвсего изменений: ${writes.length}`);
if (APPLY) { await commit(writes); console.log("применено"); }
else console.log("предпросмотр, запустите с --apply");
