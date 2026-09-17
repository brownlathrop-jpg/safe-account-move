/**
 * Перенос данных из Firestore в PostgreSQL (своя база на сервере).
 * Запуск: bun scripts/migrate-firestore-to-pg.mjs
 * Нужны переменные: FIREBASE_SERVICE_ACCOUNT_JSON, DATABASE_URL
 */
import { cert } from "firebase-admin/app";
import postgres from "postgres";

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const REST = `https://firestore.googleapis.com/v1/projects/${svc.project_id}/databases/(default)/documents`;

const sql = postgres(process.env.DATABASE_URL, {
  max: 4,
  prepare: false,
  ssl: { rejectUnauthorized: false },
});

const TABLES = [
  "workspaces",
  "partners",
  "products",
  "product_folders",
  "product_types",
  "invoices",
  "invoice_items",
  "invoice_statuses",
  "warehouses",
  "stock_movements",
  "stock_receipts",
  "stock_receipt_items",
  "cashflow_items",
  "organizations",
  "bank_accounts",
  "banks",
  "price_types",
  "units",
];

async function token() {
  const t = await credential.getAccessToken();
  return t.access_token;
}

function fromValue(v) {
  if (v === undefined || v === null) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ("mapValue" in v)
    return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}

async function* readCollection(table) {
  let pageToken = "";
  do {
    const url = new URL(`${REST}/${table}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore ${table}: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const docs = (json.documents ?? []).map((d) => ({
      id: d.name.split("/").pop(),
      data: Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v)])),
    }));
    if (docs.length) yield docs;
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
}

async function insertBatch(table, docs) {
  const rows = docs.map((d) => ({
    id: d.id,
    workspace_id: d.data.workspace_id ?? null,
    user_id: d.data.user_id ?? null,
    data: { ...d.data, id: d.id },
  }));
  await sql`
    insert into ${sql(table)} ${sql(rows, "id", "workspace_id", "user_id", "data")}
    on conflict (id) do update set
      workspace_id = excluded.workspace_id,
      user_id = excluded.user_id,
      data = excluded.data,
      updated_at = now()`;
}

let grand = 0;
for (const table of TABLES) {
  let n = 0;
  try {
    for await (const docs of readCollection(table)) {
      await insertBatch(table, docs);
      n += docs.length;
      process.stdout.write(`\r${table}: ${n}   `);
    }
  } catch (e) {
    console.log(`\n${table}: ошибка — ${e.message}`);
    continue;
  }
  const [{ c }] = await sql`select count(*)::int as c from ${sql(table)}`;
  console.log(`\r${table}: перенесено ${n}, в базе ${c}`);
  grand += n;
}
console.log(`Всего перенесено: ${grand}`);
await sql.end();
