/**
 * Одноразовый перенос данных из старой базы (Supabase) в Firestore.
 * Запуск: bun scripts/migrate-to-firestore.mjs
 * Нужны переменные окружения: USER_SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON
 */
import { cert } from "firebase-admin/app";

const SUPABASE_URL = "https://vanefvbtetycxvotwqer.supabase.co";
const KEY = process.env.USER_SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("Нет USER_SUPABASE_SERVICE_ROLE_KEY");

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const PROJECT = svc.project_id;
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function accessToken() {
  const t = await credential.getAccessToken();
  return t.access_token;
}

// JSON -> Firestore Value
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object")
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  return { stringValue: String(v) };
}

async function restCommit(writes, attempt = 1) {
  const token = await accessToken();
  const res = await fetch(`${REST}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (attempt < 6 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      return restCommit(writes, attempt + 1);
    }
    if (res.status === 429) {
      throw new Error("Дневной лимит записей Firebase исчерпан. Скрипт можно запустить снова после сброса лимита — уже перенесённое повторно записываться не будет.");
    }
    throw new Error(`Firestore commit: ${res.status} ${text.slice(0, 300)}`);
  }
}

async function existingIds(table) {
  const ids = new Set();
  let pageToken = "";
  const token = await accessToken();
  do {
    const url = new URL(`${REST}/${table}`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.append("mask.fieldPaths", "id");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore list ${table}: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const doc of data.documents ?? []) ids.add(doc.name.split("/").pop());
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

const TABLES = [
  "workspaces",
  "profiles",
  "partners",
  "products",
  "warehouses",
  "banks",
  "bank_accounts",
  "price_types",
  "cashflow_items",
  "invoice_statuses",
  "invoices",
  "invoice_items",
  "stock_movements",
  "stock_balances",
];

async function fetchAll(table) {
  const rows = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc&limit=${step}&offset=${from}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || text.includes("does not exist")) return null;
      throw new Error(`${table}: ${res.status} ${text}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < step) break;
  }
  return rows;
}

for (const table of TABLES) {
  const rows = await fetchAll(table);
  if (rows === null) {
    console.log(`- ${table}: нет такой таблицы, пропуск`);
    continue;
  }
  const existing = await existingIds(table);
  const missing = rows.filter((row) => !existing.has(String(row.id ?? "")));
  if (missing.length === 0) {
    console.log(`= ${table}: уже перенесено ${rows.length}, пропуск`);
    continue;
  }
  const CHUNK = 200;
  let writes = [];
  let done = 0;
  for (const row of missing) {
    const id = String(row.id ?? crypto.randomUUID());
    const fields = Object.fromEntries(Object.entries({ ...row, id }).map(([k, v]) => [k, toValue(v)]));
    writes.push({ update: { name: `projects/${PROJECT}/databases/(default)/documents/${table}/${id}`, fields } });
    if (writes.length === CHUNK) {
      await restCommit(writes);
      done += writes.length;
      console.log(`  ${table}: ${done}/${missing.length}`);
      writes = [];
    }
  }
  if (writes.length) {
    await restCommit(writes);
    done += writes.length;
  }
  console.log(`+ ${table}: перенесено ${done} из ${rows.length}`);
}
console.log("Готово");
