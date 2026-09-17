// Подключение к PostgreSQL и выполнение запросов CRM.
// Только серверный код: файл никогда не попадает в браузерную сборку.
import postgres from "postgres";

type Row = Record<string, any>;

let _sql: ReturnType<typeof postgres> | null = null;

export function sql() {
  if (!_sql) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL не задан");
    _sql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      prepare: false,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _sql;
}

/* ------------------------------------------------------------- таблицы CRM */

const TABLES = new Set([
  "workspaces",
  "products",
  "product_folders",
  "product_types",
  "partners",
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
  "invoice_payments",
]);

function assertTable(t: string) {
  if (!TABLES.has(t)) throw new Error(`Неизвестная таблица: ${t}`);
  return t;
}

/* ------------------------------------------------------------------- связи */

type Rel = { table: string; fk: string; type: "one" | "many" };

const RELATIONS: Record<string, Record<string, Rel>> = {
  invoice_payments: {
    partner: { table: "partners", fk: "partner_id", type: "one" },
    invoice: { table: "invoices", fk: "invoice_id", type: "one" },
  },
  invoices: {
    partner: { table: "partners", fk: "partner_id", type: "one" },
    payments: { table: "invoice_payments", fk: "invoice_id", type: "many" },
    invoice_payments: { table: "invoice_payments", fk: "invoice_id", type: "many" },
    partners: { table: "partners", fk: "partner_id", type: "one" },
    status_ref: { table: "invoice_statuses", fk: "status_id", type: "one" },
    invoice_statuses: { table: "invoice_statuses", fk: "status_id", type: "one" },
    items: { table: "invoice_items", fk: "invoice_id", type: "many" },
    invoice_items: { table: "invoice_items", fk: "invoice_id", type: "many" },
    children: { table: "invoices", fk: "parent_id", type: "many" },
    warehouse: { table: "warehouses", fk: "warehouse_id", type: "one" },
  },
  invoice_items: {
    product: { table: "products", fk: "product_id", type: "one" },
    products: { table: "products", fk: "product_id", type: "one" },
  },
  stock_movements: {
    product: { table: "products", fk: "product_id", type: "one" },
    warehouse: { table: "warehouses", fk: "warehouse_id", type: "one" },
  },
  stock_receipt_items: {
    product: { table: "products", fk: "product_id", type: "one" },
    products: { table: "products", fk: "product_id", type: "one" },
  },
  stock_receipts: {
    items: { table: "stock_receipt_items", fk: "receipt_id", type: "many" },
    stock_receipt_items: { table: "stock_receipt_items", fk: "receipt_id", type: "many" },
    warehouse: { table: "warehouses", fk: "warehouse_id", type: "one" },
    partner: { table: "partners", fk: "partner_id", type: "one" },
  },
};

type SelectPart = { alias: string; table: string; fk?: string; fields: string[] };

function parseSelect(sel: string): { columns: string[]; nested: SelectPart[] } {
  const columns: string[] = [];
  const nested: SelectPart[] = [];
  let depth = 0;
  let buf = "";
  const parts: string[] = [];
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf);

  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/);
    if (m) {
      nested.push({
        alias: m[1] || m[2],
        table: m[2],
        fk: m[3] || undefined,
        fields: m[4].split(",").map((f) => f.trim()).filter(Boolean),
      });
    } else columns.push(p);
  }
  return { columns, nested };
}

function singular(table: string): string {
  if (table.endsWith("ies")) return table.slice(0, -3) + "y";
  if (table.endsWith("ses")) return table.slice(0, -2);
  if (table.endsWith("s")) return table.slice(0, -1);
  return table;
}

function resolveRel(parentTable: string, part: SelectPart, sample: Row | undefined): Rel {
  const known = RELATIONS[parentTable]?.[part.alias] ?? RELATIONS[parentTable]?.[part.table];
  if (known) return known;
  const one = `${singular(part.table)}_id`;
  if (sample && one in sample) return { table: part.table, fk: one, type: "one" };
  const aliasFk = `${part.alias}_id`;
  if (sample && aliasFk in sample) return { table: part.table, fk: aliasFk, type: "one" };
  return { table: part.table, fk: part.fk ?? `${singular(parentTable)}_id`, type: "many" };
}

function pick(row: Row, fields: string[]): Row {
  if (!fields.length || fields.includes("*")) return row;
  const out: Row = {};
  for (const f of fields) {
    const inner = parseSelect(f);
    if (inner.columns.length) out[inner.columns[0]] = row[inner.columns[0]] ?? null;
  }
  if (row.id !== undefined && !("id" in out)) out.id = row.id;
  return out;
}

/* ---------------------------------------------------------- строки ↔ jsonb */

const COLUMN_FIELDS = new Set(["id", "workspace_id", "user_id"]);

function toRow(r: any): Row {
  const data = (r.data ?? {}) as Row;
  const out: Row = { ...data, id: r.id };
  if (out.workspace_id === undefined) out.workspace_id = r.workspace_id ?? null;
  if (out.user_id === undefined) out.user_id = r.user_id ?? null;
  if (out.created_at === undefined && r.created_at) out.created_at = new Date(r.created_at).toISOString();
  if (out.updated_at === undefined && r.updated_at) out.updated_at = new Date(r.updated_at).toISOString();
  return out;
}

/* --------------------------------------------------------- сборка условий */

type FilterOp = "eq" | "neq" | "in" | "gte" | "lte" | "gt" | "lt" | "isnull" | "notnull";
type Filter = { op: FilterOp; field: string; value?: any };

type QuerySpec = {
  table: string;
  mode: "select" | "insert" | "update" | "upsert" | "delete";
  select?: string;
  filters?: Filter[];
  orders?: { field: string; asc: boolean }[];
  limit?: number | null;
  range?: { from: number; to: number } | null;
  payload?: Row[];
  onConflict?: string[];
  single?: "one" | "maybe" | null;
  head?: boolean;
  count?: boolean;
};

class SqlBuf {
  text = "";
  params: any[] = [];
  add(part: string, ...values: any[]) {
    let i = 0;
    this.text += part.replace(/\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.params.length}`;
    });
    return this;
  }
}

/** Выражение для поля: колонка или значение из jsonb. */
function fieldExpr(field: string, asText = true): string {
  if (COLUMN_FIELDS.has(field)) return field;
  return asText ? `(data->>'${field.replace(/'/g, "")}')` : `(data->'${field.replace(/'/g, "")}')`;
}


/* ------------------------------------------------------------- выполнение */

export async function ownedWorkspaces(userId: string): Promise<string[]> {
  const s = sql();
  const rows = await s`select id from workspaces where user_id = ${userId}`;
  return rows.map((r: any) => r.id as string);
}

async function fetchByIds(table: string, ids: string[]): Promise<Map<string, Row>> {
  const s = sql();
  const map = new Map<string, Row>();
  if (!ids.length) return map;
  const rows = await s`select * from ${s(table)} where id = any(${ids})`;
  for (const r of rows) map.set(r.id as string, toRow(r));
  return map;
}

async function fetchByFk(table: string, fk: string, ids: string[]): Promise<Map<string, Row[]>> {
  const s = sql();
  const map = new Map<string, Row[]>();
  if (!ids.length) return map;
  const rows = await s.unsafe(
    `select * from ${table} where (data->>'${fk}') = any($1)`,
    [ids] as any,
  );
  for (const r of rows as any[]) {
    const row = toRow(r);
    const key = String(row[fk]);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

async function hydrate(parentTable: string, rows: Row[], nested: SelectPart[]) {
  if (!rows.length || !nested.length) return;
  for (const part of nested) {
    const rel = resolveRel(parentTable, part, rows[0]);
    assertTable(rel.table);
    if (rel.type === "one") {
      const ids = Array.from(
        new Set(rows.map((r) => r[rel.fk]).filter((v): v is string => typeof v === "string" && !!v)),
      );
      const map = await fetchByIds(rel.table, ids);
      for (const r of rows) {
        const target = r[rel.fk] ? map.get(String(r[rel.fk])) : undefined;
        r[part.alias] = target ? pick(target, part.fields) : null;
      }
    } else {
      const map = await fetchByFk(rel.table, rel.fk, rows.map((r) => String(r.id)));
      for (const r of rows) r[part.alias] = (map.get(String(r.id)) ?? []).map((c) => pick(c, part.fields));
    }
  }
}

function splitRow(item: Row) {
  const data: Row = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === "id") continue;
    data[k] = v;
  }
  return {
    id: item.id ? String(item.id) : crypto.randomUUID(),
    workspace_id: item.workspace_id ? String(item.workspace_id) : null,
    user_id: item.user_id ? String(item.user_id) : null,
    data,
  };
}

export async function runQuery(
  spec: QuerySpec,
  userId: string,
  userEmail = "",
): Promise<{ data: any; error: any; count?: number }> {
  const table = assertTable(spec.table);
  const s = sql();
  const { accessibleWorkspaces, roleIn, canWrite, logChange } = await import("./team.server");
  const scope = await accessibleWorkspaces(userId);

  /** Проверить право записи в затронутые базы. */
  const assertWrite = async (wsIds: (string | null)[]) => {
    const ids = Array.from(new Set(wsIds.filter((x): x is string => !!x)));
    if (!ids.length) {
      // общие записи без привязки к базе — только для владельцев баз
      const own = await ownedWorkspaces(userId);
      if (!own.length) throw new Error("Недостаточно прав для изменения данных");
      return;
    }
    for (const id of ids) {
      const role = await roleIn(userId, id);
      if (!role) throw new Error("Нет доступа к этой базе");
      if (!canWrite(role, table)) throw new Error("Недостаточно прав для изменения данных");
    }
  };
  const log = (op: "insert" | "update" | "delete", rows: Row[], changes?: Record<string, unknown>) => {
    for (const r of rows.slice(0, 50)) {
      void logChange({
        table,
        docId: r.id ? String(r.id) : null,
        workspaceId: r.workspace_id ? String(r.workspace_id) : null,
        userId,
        userEmail,
        op,
        changes: changes ?? {},
      });
    }
  };


  try {
    if (spec.mode === "select") {
      const buf = new SqlBuf();
      buf.text = `select * from ${table}`;
      applyWhere(buf, spec.filters ?? [], scope, table);
      const orders = spec.orders ?? [];
      if (orders.length) {
        buf.text +=
          " order by " +
          orders
            .map((o) => `${fieldExpr(o.field, false)} ${o.asc ? "asc" : "desc"} nulls last`)
            .join(", ");
      }
      let limit = spec.limit ?? null;
      let offset = 0;
      if (spec.range) {
        offset = spec.range.from;
        limit = spec.range.to - spec.range.from + 1;
      }
      if (spec.head) {
        const c = new SqlBuf();
        c.text = `select count(*)::int as n from ${table}`;
        applyWhere(c, spec.filters ?? [], scope, table);
        const res = await s.unsafe(c.text, c.params as any);
        return { data: null, error: null, count: (res as any[])[0]?.n ?? 0 };
      }
      let total: number | undefined;
      if (spec.count) {
        const c = new SqlBuf();
        c.text = `select count(*)::int as n from ${table}`;
        applyWhere(c, spec.filters ?? [], scope, table);
        const res = await s.unsafe(c.text, c.params as any);
        total = (res as any[])[0]?.n ?? 0;
      }
      if (limit !== null) buf.text += ` limit ${Number(limit)}`;
      if (offset) buf.text += ` offset ${Number(offset)}`;

      const res = await s.unsafe(buf.text, buf.params as any);
      const rows = (res as any[]).map(toRow);
      const { columns, nested } = parseSelect(spec.select ?? "*");
      await hydrate(table, rows, nested);
      const shaped =
        columns.includes("*") || columns.length === 0
          ? rows
          : rows.map((r) => {
              const out: Row = { id: r.id };
              for (const c of columns) out[c] = r[c] ?? null;
              for (const n of nested) out[n.alias] = r[n.alias];
              return out;
            });
      if (spec.single) {
        if (!shaped.length) {
          return spec.single === "one"
            ? { data: null, error: { message: "Запись не найдена" } }
            : { data: null, error: null };
        }
        return { data: shaped[0], error: null };
      }
      return { data: shaped, error: null, count: total };
    }

    if (spec.mode === "insert" || spec.mode === "upsert") {
      const payload = spec.payload ?? [];
      await assertWrite(payload.map((i) => (i.workspace_id ? String(i.workspace_id) : null)));
      const conflict = spec.onConflict ?? ["id"];
      const out: Row[] = [];
      for (const item of payload) {
        const now = new Date().toISOString();
        let existingId: string | null = null;
        if (spec.mode === "upsert") {
          const keys = conflict.filter((k) => item[k] !== undefined);
          if (keys.length) {
            const c = new SqlBuf();
            c.text = `select id from ${table}`;
            applyWhere(
              c,
              keys.map((k) => ({ op: "eq" as FilterOp, field: k, value: item[k] })),
              null,
              table,
            );
            c.text += " limit 1";
            const found = await s.unsafe(c.text, c.params as any);
            existingId = (found as any[])[0]?.id ?? null;
          }
        }
        if (existingId) {
          const patch = { ...item, updated_at: now };
          delete (patch as Row).id;
          const res = await s.unsafe(
            `update ${table} set data = data || $1::jsonb,
               workspace_id = coalesce($2, workspace_id),
               user_id = coalesce($3, user_id),
               updated_at = now()
             where id = $4 returning *`,
            [
              s.json(patch as any),
              item.workspace_id ?? null,
              item.user_id ?? null,
              existingId,
            ] as any,
          );
          out.push(toRow((res as any[])[0]));
        } else {
          const r = splitRow({ created_at: now, ...item });
          const res = await s.unsafe(
            `insert into ${table} (id, workspace_id, user_id, data)
             values ($1, $2, $3, $4::jsonb)
             on conflict (id) do update set data = ${table}.data || excluded.data, updated_at = now()
             returning *`,
            [r.id, r.workspace_id, r.user_id, s.json({ ...r.data, id: r.id } as any)] as any,
          );
          out.push(toRow((res as any[])[0]));
        }
      }
      log(spec.mode === "upsert" ? "update" : "insert", out);
      if (spec.single) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }

    if (spec.mode === "update") {
      await assertWrite(await affectedWorkspaces(s, table, spec.filters ?? [], scope));
      const patch = { ...(spec.payload?.[0] ?? {}), updated_at: new Date().toISOString() };
      delete (patch as Row).id;
      const buf = new SqlBuf();
      buf.text = `update ${table} set data = data || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb, updated_at = now()`;
      const w = new SqlBuf();
      w.text = "";
      applyWhere(w, spec.filters ?? [], scope, table);
      buf.text += w.text + " returning *";
      buf.params.push(...w.params);
      const res = await s.unsafe(buf.text, buf.params as any);
      const rows = (res as any[]).map(toRow);
      log("update", rows, patch as Record<string, unknown>);
      if (spec.single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    // delete
    await assertWrite(await affectedWorkspaces(s, table, spec.filters ?? [], scope));
    const buf = new SqlBuf();
    buf.text = `delete from ${table}`;
    applyWhere(buf, spec.filters ?? [], scope, table);
    buf.text += " returning *";
    const res = await s.unsafe(buf.text, buf.params as any);
    const deleted = (res as any[]).map(toRow);
    log("delete", deleted);
    return { data: deleted, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  }
}

/** Базы, затронутые фильтрами (для проверки прав). */
async function affectedWorkspaces(
  s: any,
  table: string,
  filters: Filter[],
  scope: string[] | null,
): Promise<(string | null)[]> {
  const explicit = filters.find((f) => f.field === "workspace_id" && f.op === "eq");
  if (explicit) return [String(explicit.value)];
  const c = new SqlBuf();
  const col = table === "workspaces" ? "id" : "workspace_id";
  c.text = `select distinct ${col} as ws from ${table}`;
  applyWhere(c, filters, scope, table);
  c.text += " limit 20";
  const rows = await s.unsafe(c.text, c.params as any);
  return (rows as any[]).map((r) => (r.ws ? String(r.ws) : null));
}

/** WHERE со сквозной нумерацией параметров. */
function applyWhere(buf: SqlBuf, filters: Filter[], scope: string[] | null, table: string) {
  const parts: string[] = [];
  const push = (text: string, ...vals: any[]) => {
    let i = 0;
    parts.push(
      text.replace(/\?/g, () => {
        buf.params.push(vals[i++]);
        return `$${buf.params.length}`;
      }),
    );
  };
  for (const f of filters) {
    const col = fieldExpr(f.field);
    switch (f.op) {
      case "eq":
        if (f.value === null || f.value === undefined) push(`(${col} IS NULL OR ${col} = '')`);
        else push(`${col} = ?`, String(f.value));
        break;
      case "neq":
        push(`${col} IS DISTINCT FROM ?`, String(f.value));
        break;
      case "in": {
        const vals = (f.value as any[]).map(String);
        if (!vals.length) parts.push("false");
        else push(`${col} = ANY(?)`, vals);
        break;
      }
      case "gte":
        push(`${col} >= ?`, String(f.value));
        break;
      case "lte":
        push(`${col} <= ?`, String(f.value));
        break;
      case "gt":
        push(`${col} > ?`, String(f.value));
        break;
      case "lt":
        push(`${col} < ?`, String(f.value));
        break;
      case "isnull":
        parts.push(`(${col} IS NULL OR ${col} = '')`);
        break;
      case "notnull":
        parts.push(`(${col} IS NOT NULL AND ${col} <> '')`);
        break;
    }
  }
  if (scope) {
    if (table === "workspaces") {
      if (scope.length) push(`id = ANY(?)`, scope);
      else parts.push("false");
    } else if (scope.length) push(`(workspace_id IS NULL OR workspace_id = ANY(?))`, scope);
    else parts.push("workspace_id IS NULL");
  }
  if (parts.length) buf.text += ` WHERE ${parts.join(" AND ")}`;
}

export async function getRowById(table: string, id: string): Promise<Row | null> {
  assertTable(table);
  const s = sql();
  const rows = await s`select * from ${s(table)} where id = ${id} limit 1`;
  return rows.length ? toRow(rows[0]) : null;
}

export type { QuerySpec };

