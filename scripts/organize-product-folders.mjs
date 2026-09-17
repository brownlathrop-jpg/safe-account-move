/**
 * Раскладывает корневые папки товаров по папкам-производителям (как в BigBird).
 * Запуск: bun scripts/organize-product-folders.mjs [--apply]
 * Без --apply только показывает, что будет сделано.
 */
import { cert } from "firebase-admin/app";
import { randomUUID } from "crypto";

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const PROJECT = svc.project_id;
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCPATH = `projects/${PROJECT}/databases/(default)/documents`;
const token = async () => (await credential.getAccessToken()).access_token;
const APPLY = process.argv.includes("--apply");

// Названия производителей: ключ — папка, значение — что искать в названии товара
const BRANDS = [
  ["Solo Porte", [/solo\s*porte/i]],
  ["Uberture", [/uberture/i]],
  ["Дубрава", [/дубрава/i]],
  ["ВДК", [/\bвдк\b/i]],
  ["Дера", [/\bдера\b/i]],
  ["Lidman", [/lidman/i]],
  ["Матадор", [/матадор/i]],
  ["Casa Porte", [/casa\s*porte/i]],
  ["ВФД", [/\bвфд\b/i]],
  ["Foret", [/\bforet\b/i]],
  ["Avanzati", [/avanzati/i]],
  ["LaStella", [/la\s*stella|lasteella|lastella/i]],
  ["Собрание", [/собрание/i]],
  ["ElDorf", [/eldorf/i]],
  ["Prizma", [/prizma/i]],
  ["Echo", [/\becho\b/i]],
  ["Легро", [/легро/i]],
  ["Миракс", [/миракс/i]],
  ["Сварог", [/сварог/i]],
];
// Эти корневые папки не трогаем
const KEEP_ROOT = new Set(["услуги", "товары", "товары и услуги", "фурнитура", "удаленное", "!для чеков", "петли", "замки", "ручки"]);

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
    while (true) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
      if (res.ok) break;
      if (++tries > 8) throw new Error(`${table}: ${res.status}`);
      await new Promise((r) => setTimeout(r, tries * 5000));
    }
    const data = await res.json();
    for (const d of data.documents ?? []) {
      const row = { id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields ?? {})) row[k] = fromValue(v);
      out.push(row);
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const res = await fetch(`${REST}:commit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    if (!res.ok) throw new Error(`commit ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

const products = await listAll("products");
const folders = await listAll("product_folders");

const childFolders = new Map();
for (const f of folders) {
  const a = childFolders.get(f.parent_id ?? null) ?? [];
  a.push(f);
  childFolders.set(f.parent_id ?? null, a);
}
const productsByFolder = new Map();
for (const p of products) {
  const a = productsByFolder.get(p.folder_id ?? null) ?? [];
  a.push(p);
  productsByFolder.set(p.folder_id ?? null, a);
}
// все товары папки и её подпапок
function subtreeProducts(id, acc = []) {
  acc.push(...(productsByFolder.get(id) ?? []));
  for (const c of childFolders.get(id) ?? []) subtreeProducts(c.id, acc);
  return acc;
}
function detectBrand(names) {
  const score = new Map();
  for (const n of names) {
    for (const [brand, pats] of BRANDS) {
      if (pats.some((p) => p.test(n))) score.set(brand, (score.get(brand) ?? 0) + 1);
    }
  }
  if (!score.size) return null;
  const [brand, hits] = [...score].sort((a, b) => b[1] - a[1])[0];
  return hits / Math.max(names.length, 1) >= 0.5 ? brand : null;
}

const writes = [];
const report = new Map();

for (const wsId of [...new Set(folders.map((f) => f.workspace_id))]) {
  const wsFolders = folders.filter((f) => f.workspace_id === wsId);
  const roots = wsFolders.filter((f) => !f.parent_id);
  const brandFolder = new Map();
  for (const f of roots) {
    const key = (f.name ?? "").trim().toLowerCase();
    if (BRANDS.some(([b]) => b.toLowerCase() === key)) brandFolder.set(BRANDS.find(([b]) => b.toLowerCase() === key)[0], f);
  }
  const userId = wsFolders[0]?.user_id ?? products[0]?.user_id;

  for (const f of roots) {
    const key = (f.name ?? "").trim().toLowerCase();
    if (KEEP_ROOT.has(key)) continue;
    if ([...brandFolder.values()].some((b) => b.id === f.id)) continue;
    const names = subtreeProducts(f.id).map((p) => p.name ?? "");
    if (!names.length) continue;
    const brand = detectBrand(names);
    if (!brand) continue;
    let parent = brandFolder.get(brand);
    if (!parent) {
      const now = new Date().toISOString();
      parent = { id: randomUUID(), name: brand, parent_id: null, workspace_id: wsId, user_id: userId, created_at: now, updated_at: now, ext_1c_id: null };
      brandFolder.set(brand, parent);
      writes.push({ update: { name: `${DOCPATH}/product_folders/${parent.id}`, fields: Object.fromEntries(Object.entries(parent).map(([k, v]) => [k, toValue(v)])) } });
    }
    writes.push({
      update: { name: `${DOCPATH}/product_folders/${f.id}`, fields: { parent_id: toValue(parent.id), updated_at: toValue(new Date().toISOString()) } },
      updateMask: { fieldPaths: ["parent_id", "updated_at"] },
    });
    const r = report.get(brand) ?? [];
    r.push(`${f.name} (${names.length})`);
    report.set(brand, r);
  }
}

for (const [brand, list] of [...report].sort()) {
  console.log(`${brand}: ${list.length} папок`);
  for (const l of list) console.log(`   ${l}`);
}
console.log(`\nвсего изменений: ${writes.length}`);
if (APPLY) {
  await commit(writes);
  console.log("применено");
} else {
  console.log("это предпросмотр, запустите с --apply");
}
