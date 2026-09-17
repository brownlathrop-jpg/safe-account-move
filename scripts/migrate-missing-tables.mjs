/**
 * Донос недостающих таблиц из старой базы (Supabase) в Firestore.
 * Запуск: bun scripts/migrate-missing-tables.mjs [table1 table2 ...]
 * По умолчанию: product_folders, partner_folders, stock_receipts, stock_receipt_items
 */
import { cert } from "firebase-admin/app";

const SUPABASE_URL = "https://vanefvbtetycxvotwqer.supabase.co";
const KEY = process.env.USER_SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("Нет USER_SUPABASE_SERVICE_ROLE_KEY");

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const PROJECT = svc.project_id;
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCPATH = `projects/${PROJECT}/databases/(default)/documents`;
const token = async () => (await credential.getAccessToken()).access_token;

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  return { stringValue: String(v) };
}

async function commit(writes, attempt = 1) {
  const res = await fetch(`${REST}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (attempt < 6 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, attempt * 4000));
      return commit(writes, attempt + 1);
    }
    throw new Error(`commit ${res.status} ${text.slice(0, 300)}`);
  }
}

async function existingIds(table) {
  const ids = new Set();
  let pageToken = "";
  do {
    const url = new URL(`${REST}/${table}`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.append("mask.fieldPaths", "id");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) return ids;
    const data = await res.json();
    for (const d of data.documents ?? []) ids.add(d.name.split("/").pop());
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

async function fetchAll(table) {
  const rows = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc&limit=${step}&offset=${from}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || text.includes("does not exist")) return null;
      throw new Error(`${table}: ${res.status} ${text.slice(0, 200)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < step) break;
  }
  return rows;
}

const TABLES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["product_folders", "partner_folders", "stock_receipts", "stock_receipt_items"];

for (const table of TABLES) {
  const rows = await fetchAll(table);
  if (!rows) {
    console.log(`${table}: нет в старой базе — пропуск`);
    continue;
  }
  const have = await existingIds(table);
  const todo = rows.filter((r) => !have.has(r.id));
  console.log(`${table}: всего ${rows.length}, уже есть ${have.size}, переносим ${todo.length}`);
  for (let i = 0; i < todo.length; i += 400) {
    const chunk = todo.slice(i, i + 400);
    await commit(
      chunk.map((r) => ({
        update: {
          name: `${DOCPATH}/${table}/${r.id}`,
          fields: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toValue(v)])),
        },
      })),
    );
    console.log(`  ${Math.min(i + 400, todo.length)}/${todo.length}`);
  }
  const after = await existingIds(table);
  console.log(`${table}: итог ${after.size}/${rows.length}`);
}
