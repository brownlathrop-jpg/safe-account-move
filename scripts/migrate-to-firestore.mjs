/**
 * Одноразовый перенос данных из старой базы (Supabase) в Firestore.
 * Запуск: bun scripts/migrate-to-firestore.mjs
 * Нужны переменные окружения: USER_SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const SUPABASE_URL = "https://vanefvbtetycxvotwqer.supabase.co";
const KEY = process.env.USER_SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("Нет USER_SUPABASE_SERVICE_ROLE_KEY");

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(svc), projectId: svc.project_id });
const fs = getFirestore();

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
  let batch = fs.batch();
  let n = 0;
  for (const row of rows) {
    const id = String(row.id ?? fs.collection(table).doc().id);
    batch.set(fs.collection(table).doc(id), { ...row, id }, { merge: true });
    n++;
    if (n % 400 === 0) {
      await batch.commit();
      batch = fs.batch();
    }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`+ ${table}: ${rows.length}`);
}
console.log("Готово");
