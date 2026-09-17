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
    if (attempt < 6 && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      return restCommit(writes, attempt + 1);
    }
    throw new Error(`Firestore commit: ${res.status} ${text.slice(0, 300)}`);
  }
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
  async function writeChunk(docs, attempt = 1) {
    try {
      const batch = fs.batch();
      for (const [id, row] of docs) {
        batch.set(fs.collection(table).doc(id), { ...row, id }, { merge: true });
      }
      await batch.commit();
    } catch (e) {
      if (attempt >= 6) throw e;
      const wait = attempt * 5000;
      console.log(`  ! обрыв связи, повтор через ${wait / 1000}с (попытка ${attempt})`);
      await new Promise((r) => setTimeout(r, wait));
      return writeChunk(docs, attempt + 1);
    }
  }
  const CHUNK = 200;
  let chunk = [];
  for (const row of rows) {
    const id = String(row.id ?? fs.collection(table).doc().id);
    chunk.push([id, row]);
    if (chunk.length === CHUNK) {
      await writeChunk(chunk);
      chunk = [];
    }
  }
  if (chunk.length) await writeChunk(chunk);
  console.log(`+ ${table}: ${rows.length}`);
}
console.log("Готово");
