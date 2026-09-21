// Подключение к PostgreSQL и выполнение запросов CRM.
// Только серверный код: файл никогда не попадает в браузерную сборку.
import postgres from "postgres";

type Row = Record<string, any>;

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Настройка шифрования соединения с базой.
 * База на этом же сервере (127.0.0.1) — шифрование не нужно.
 * База на другом сервере — обязательно проверяем сертификат;
 * самоподписанный сертификат кладём в PGSSLROOTCERT.
 */
export function sslOption(url: string): any {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  const ca = process.env["PGSSLROOTCERT"];
  if (ca) return { rejectUnauthorized: true, ca };
  // корневого сертификата нет: канал шифруется, но имя сервера не проверяется
  return { rejectUnauthorized: false };
}

export function sql() {
  if (!_sql) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL не задан");
    _sql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      prepare: false,
      ssl: sslOption(url),
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
  "discounts",
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

/**
 * Справочники, ОСОЗНАННО общие для всех баз.
 * Пусто по умолчанию: пустой workspace_id больше не открывает запись всем.
 * Добавлять сюда таблицу только если это действительно глобальный справочник.
 */
const GLOBAL_TABLES = new Set<string>([]);

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

/** Защита от подделки имён полей (вторая линия защиты). */
export function assertField(field: unknown): string {
  if (typeof field !== "string" || !FIELD_RE.test(field)) {
    throw new Error(`Недопустимое имя поля: ${String(field).slice(0, 40)}`);
  }
  return field;
}

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
  const f = assertField(field);
  if (COLUMN_FIELDS.has(f)) return f;
  return asText ? `(data->>'${f}')` : `(data->'${f}')`;
}


/* ------------------------------------------------------------- выполнение */

export async function ownedWorkspaces(userId: string): Promise<string[]> {
  const s = sql();
  const rows = await s`select id from workspaces where user_id = ${userId}`;
  return rows.map((r: any) => r.id as string);
}

/** Условие «запись принадлежит доступным базам» для дочерних выборок. */
function scopeCond(table: string, paramIdx: number): string {
  const col = table === "workspaces" ? "id" : "workspace_id";
  return GLOBAL_TABLES.has(table)
    ? ` and (${col} is null or ${col} = any($${paramIdx}::text[]))`
    : ` and ${col} = any($${paramIdx}::text[])`;
}

async function fetchByIds(table: string, ids: string[], scope: string[]): Promise<Map<string, Row>> {
  assertTable(table);
  const s = sql();
  const map = new Map<string, Row>();
  if (!ids.length || !scope.length) return map;
  const rows = await s.unsafe(
    `select * from ${table} where id = any($1::text[])${scopeCond(table, 2)}`,
    [ids, scope] as any,
  );
  for (const r of rows as any[]) map.set(r.id as string, toRow(r));
  return map;
}

async function fetchByFk(
  table: string,
  fk: string,
  ids: string[],
  scope: string[],
): Promise<Map<string, Row[]>> {
  assertTable(table);
  const key = assertField(fk);
  const s = sql();
  const map = new Map<string, Row[]>();
  if (!ids.length || !scope.length) return map;
  const rows = await s.unsafe(
    `select * from ${table} where (data->>'${key}') = any($1::text[])${scopeCond(table, 2)}`,
    [ids, scope] as any,
  );
  for (const r of rows as any[]) {
    const row = toRow(r);
    const k = String(row[key]);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

async function hydrate(parentTable: string, rows: Row[], nested: SelectPart[], scope: string[]) {
  if (!rows.length || !nested.length) return;
  for (const part of nested) {
    const rel = resolveRel(parentTable, part, rows[0]);
    assertTable(rel.table);
    if (rel.type === "one") {
      const ids = Array.from(
        new Set(rows.map((r) => r[rel.fk]).filter((v): v is string => typeof v === "string" && !!v)),
      );
      const map = await fetchByIds(rel.table, ids, scope);
      for (const r of rows) {
        const target = r[rel.fk] ? map.get(String(r[rel.fk])) : undefined;
        r[part.alias] = target ? pick(target, part.fields) : null;
      }
    } else {
      const map = await fetchByFk(rel.table, rel.fk, rows.map((r) => String(r.id)), scope);
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

/**
 * Пересчитать сумму (total) документов после изменения их позиций.
 * Вызывается для таблицы invoice_items, чтобы сумма всегда совпадала
 * с позициями, а также заполняет базу (workspace_id) у строк.
 */
async function syncInvoiceTotals(table: string, rows: Row[]) {
  if (table !== "invoice_items" || !rows.length) return;
  const s = sql();
  const ids = Array.from(
    new Set(rows.map((r) => (r as any).invoice_id).filter((v): v is string => typeof v === "string" && !!v)),
  );
  if (!ids.length) return;
  try {
    await s.unsafe(
      `update invoice_items it
          set workspace_id = i.workspace_id
         from invoices i
        where i.id = it.data->>'invoice_id'
          and it.workspace_id is null
          and (it.data->>'invoice_id') = any($1::text[])`,
      [ids] as any,
    );
    await s.unsafe(
      `update invoices i
          set data = jsonb_set(i.data, '{total}', to_jsonb(coalesce(t.s, 0)), true),
              updated_at = now()
         from (
           select (data->>'invoice_id') as inv,
                  sum(coalesce((data->>'sum')::numeric,
                               coalesce((data->>'quantity')::numeric, 0) * coalesce((data->>'price')::numeric, 0))) as s
             from invoice_items
            where (data->>'invoice_id') = any($1::text[])
            group by 1
         ) t
        where i.id = t.inv`,
      [ids] as any,
    );
    // документы, у которых позиций больше не осталось
    await s.unsafe(
      `update invoices i
          set data = jsonb_set(i.data, '{total}', to_jsonb(0), true), updated_at = now()
        where i.id = any($1::text[])
          and not exists (select 1 from invoice_items it where it.data->>'invoice_id' = i.id)`,
      [ids] as any,
    );
  } catch {
    // пересчёт суммы не должен ломать сохранение позиций
  }
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
  const assertWrite = async (wsIds: (string | null)[], adding = 0) => {
    const { assertWriteAllowed, assertInsertLimit, assertCanCreateWorkspace } = await import(
      "./billing.server"
    );
    const ids = Array.from(new Set(wsIds.filter((x): x is string => !!x)));
    if (!ids.length) {
      // создание своей базы: почта подтверждена и лимит тарифа не исчерпан
      if (table === "workspaces") {
        await assertCanCreateWorkspace(userId);
        return;
      }
      // запись без базы больше не разрешена (кроме явных общих справочников)
      if (!GLOBAL_TABLES.has(table)) throw new Error("Не указана база (workspace_id)");
      return;
    }
    for (const id of ids) {
      const role = await roleIn(userId, id);
      if (!role) throw new Error("Нет доступа к этой базе");
      if (!canWrite(role, table)) throw new Error("Недостаточно прав для изменения данных");
      // приостановленная или неоплаченная база — только чтение
      await assertWriteAllowed(id);
      if (adding > 0) await assertInsertLimit(table, id, adding);
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
      await hydrate(table, rows, nested, scope ?? []);
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
      // владельцем новой базы всегда становится вошедший пользователь
      const payload = (spec.payload ?? []).map((i) =>
        table === "workspaces" ? { ...i, user_id: userId } : i,
      );
      await assertWrite(
        payload.map((i) => (i.workspace_id ? String(i.workspace_id) : null)),
        spec.mode === "insert" ? payload.length : 0,
      );
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
            const conflictFilters: Filter[] = keys.map((k) => ({
              op: "eq" as FilterOp,
              field: k,
              value: item[k],
            }));
            // База фиксируется явно: совпадение не может найтись в чужой базе.
            if (table !== "workspaces" && !keys.includes("workspace_id")) {
              if (!item.workspace_id) throw new Error("Не указана база (workspace_id)");
              conflictFilters.push({
                op: "eq" as FilterOp,
                field: "workspace_id",
                value: String(item.workspace_id),
              });
            }
            applyWhere(c, conflictFilters, scope, table);
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
             where id = $4
               and ($5::text[] is null or workspace_id = any($5::text[]))
             returning *`,
            [
              s.json(patch as any),
              item.workspace_id ?? null,
              item.user_id ?? null,
              existingId,
              table === "workspaces" ? null : scope,
            ] as any,
          );
          if (!(res as any[]).length) throw new Error("Нет доступа к этой записи");
          out.push(toRow((res as any[])[0]));
        } else {
          const r = splitRow({ created_at: now, ...item });
          // при совпадении id дополняем запись только если она в доступной базе
          const guardCol = table === "workspaces" ? "id" : "workspace_id";
          const res = await s.unsafe(
            `insert into ${table} (id, workspace_id, user_id, data)
             values ($1, $2, $3, $4::jsonb)
             on conflict (id) do update set data = ${table}.data || excluded.data, updated_at = now()
               where $5::text[] is null or ${table}.${guardCol} = any($5::text[])
             returning *`,
            [
              r.id,
              r.workspace_id,
              r.user_id,
              s.json({ ...r.data, id: r.id } as any),
              scope,
            ] as any,
          );
          if (!(res as any[]).length) throw new Error("Нет доступа к этой записи");
          out.push(toRow((res as any[])[0]));
        }
      }
      log(spec.mode === "upsert" ? "update" : "insert", out);
      await syncInvoiceTotals(table, out);
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
      await syncInvoiceTotals(table, rows);
      if (spec.single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    // delete
    await assertWrite(await affectedWorkspaces(s, table, spec.filters ?? [], scope));
    // Товары с движениями/документами пропускаем, остальные удаляем.
    let skipIds: string[] = [];
    if (table === "products") skipIds = await usedProductIds(s, spec.filters ?? [], scope);
    const buf = new SqlBuf();
    buf.text = `delete from ${table}`;
    applyWhere(buf, spec.filters ?? [], scope, table);
    if (skipIds.length) {
      buf.params.push(skipIds);
      const cond = `products.id <> all($${buf.params.length})`;
      buf.text += /\swhere\s/i.test(buf.text) ? ` and ${cond}` : ` where ${cond}`;
    }
    buf.text += " returning *";
    const res = await s.unsafe(buf.text, buf.params as any);
    const deleted = (res as any[]).map(toRow);
    log("delete", deleted);
    await syncInvoiceTotals(table, deleted);
    if (table === "products" && skipIds.length && !deleted.length) {
      return {
        data: null,
        error: {
          message:
            skipIds.length === 1
              ? "Нельзя удалить товар, по которому есть движения или документы"
              : `Нельзя удалить ${skipIds.length} товаров: по ним есть движения или документы`,
        },
      };
    }
    return { data: deleted, error: null, skipped: skipIds.length } as any;
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
  const rows = await s.unsafe(c.text, c.params as any);
  return (rows as any[]).map((r) => (r.ws ? String(r.ws) : null));
}

/**
 * Товары, по которым есть движения по складу или строки документов: их нельзя
 * удалять, иначе остатки, себестоимость и отчёты «теряют» историю.
 */
async function usedProductIds(s: any, filters: Filter[], scope: string[] | null): Promise<string[]> {
  const c = new SqlBuf();
  c.text = "select id from products";
  applyWhere(c, filters, scope, "products");
  const ids = ((await s.unsafe(c.text, c.params as any)) as any[]).map((r) => String(r.id));
  if (!ids.length) return [];
  const used = (await s`
    select p.id from products p
    where p.id = any(${ids}) and (
      exists (select 1 from stock_movements m where m.data->>'product_id' = p.id)
      or exists (select 1 from invoice_items i where i.data->>'product_id' = p.id)
      or exists (select 1 from stock_receipt_items r where r.data->>'product_id' = p.id)
    )
  `) as unknown as { id: string }[];
  return used.map((u) => String(u.id));
}

/** Значение — число (в том числе строкой), а не дата и не текст. */
function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  return /^-?\d+(\.\d+)?$/.test(v.trim());
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
      case "lte":
      case "gt":
      case "lt": {
        const sign = f.op === "gte" ? ">=" : f.op === "lte" ? "<=" : f.op === "gt" ? ">" : "<";
        // числа сравниваем как числа (иначе «9» > «10»), даты и прочее — как текст
        if (isNumericValue(f.value)) {
          push(
            // в шаблоне нельзя использовать «?» — это метка параметра
            `(case when ${col} ~ '^-{0,1}[0-9]+([.][0-9]+){0,1}$' then (${col})::numeric else null end) ${sign} ?`,
            Number(f.value),
          );
        } else push(`${col} ${sign} ?`, String(f.value));
        break;
      }
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
    } else if (GLOBAL_TABLES.has(table)) {
      if (scope.length) push(`(workspace_id IS NULL OR workspace_id = ANY(?))`, scope);
      else parts.push("workspace_id IS NULL");
    } else {
      if (scope.length) push(`workspace_id = ANY(?)`, scope);
      else parts.push("false");
    }
  }
  // скобки обязательны: OR внутри условий не должен перебивать AND с базой
  if (parts.length) buf.text += ` WHERE (${parts.join(" AND ")})`;
}

export async function getRowById(
  table: string,
  id: string,
  scope: string[],
): Promise<Row | null> {
  assertTable(table);
  if (!scope.length) return null;
  const s = sql();
  const col = table === "workspaces" ? "id" : "workspace_id";
  const rows = await s.unsafe(
    `select * from ${table} where id = $1 and ${col} = any($2::text[]) limit 1`,
    [id, scope] as any,
  );
  return (rows as any[]).length ? toRow((rows as any[])[0]) : null;
}

export type { QuerySpec };

