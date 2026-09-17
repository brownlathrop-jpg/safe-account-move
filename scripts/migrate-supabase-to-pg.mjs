/**
 * Перенос данных из старой базы (Supabase) в PostgreSQL на своём сервере.
 * Запуск: DATABASE_URL=... bun scripts/migrate-supabase-to-pg.mjs
 * Нужны переменные: USER_SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 */
import postgres from "postgres";

const SUPABASE_URL = "https://vanefvbtetycxvotwqer.supabase.co";
const KEY = process.env.USER_SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("Нет USER_SUPABASE_SERVICE_ROLE_KEY");

const sql = postgres(process.env.DATABASE_URL, {
  max: 4,
  prepare: false,
  ssl: { rejectUnauthorized: false },
});

const TABLES = [
  "workspaces",
  "partners",
  "product_folders",
  "product_types",
  "products",
  "units",
  "warehouses",
  "banks",
  "bank_accounts",
  "organizations",
  "price_types",
  "cashflow_items",
  "invoice_statuses",
  "invoices",
  "invoice_items",
  "stock_movements",
  "stock_receipts",
  "stock_receipt_items",
];

async function fetchPage(table, from, step) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.asc&limit=${step}&offset=${from}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || text.includes("does not exist")) return null;
    throw new Error(`${table}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function insertBatch(table, rows) {
  const payload = rows.map((r) => ({
    id: String(r.id),
    workspace_id: r.workspace_id ?? null,
    user_id: r.user_id ?? null,
    data: { ...r, id: String(r.id) },
  }));
  await sql`
    insert into ${sql(table)} ${sql(payload, "id", "workspace_id", "user_id", "data")}
    on conflict (id) do update set
      workspace_id = excluded.workspace_id,
      user_id = excluded.user_id,
      data = excluded.data,
      updated_at = now()`;
}

let grand = 0;
for (const table of TABLES) {
  const step = 500;
  let n = 0;
  let skipped = false;
  for (let from = 0; ; from += step) {
    const page = await fetchPage(table, from, step);
    if (page === null) {
      console.log(`- ${table}: нет в старой базе, пропуск`);
      skipped = true;
      break;
    }
    if (page.length) {
      await insertBatch(table, page);
      n += page.length;
    }
    if (page.length < step) break;
  }
  if (skipped) continue;
  const [{ c }] = await sql`select count(*)::int as c from ${sql(table)}`;
  console.log(`${table}: перенесено ${n}, всего в базе ${c}`);
  grand += n;
}
console.log(`Всего перенесено: ${grand}`);
await sql.end();
