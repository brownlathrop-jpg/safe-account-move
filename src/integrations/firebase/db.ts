/**
 * Слой доступа к данным на Firestore.
 *
 * Повторяет знакомый по коду проекта интерфейс запросов
 * (`db.from("products").select(...).eq(...).order(...)`), чтобы страницы CRM
 * работали с Firestore без переписывания каждого экрана.
 *
 * Особенности реализации:
 * - фильтры равенства уходят в Firestore, остальные условия и сортировка
 *   выполняются в памяти (не требует составных индексов);
 * - у каждого документа поле `id` дублирует идентификатор документа;
 * - связи (partner, items, children и т.п.) описаны в RELATIONS ниже.
 */
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  type QueryConstraint,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { fbAuth, fbFirestore, fbStorage } from "./client";

/* ------------------------------------------------------------------ утилиты */

type Row = Record<string, any>;

function plain(id: string, data: Row): Row {
  const out: Row = { id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Timestamp ? v.toDate().toISOString() : v;
  }
  out.id = id;
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function cmp(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), "ru");
}

/* --------------------------------------------------------------- связи (join) */

type Rel = { table: string; fk: string; type: "one" | "many" };

const RELATIONS: Record<string, Record<string, Rel>> = {
  invoices: {
    partner: { table: "partners", fk: "partner_id", type: "one" },
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
    const m = p.match(/^(?:([\w]+):)?([\w]+)(?:!([\w]+))?\((.*)\)$/);
    if (m) {
      const [, alias, table, fk, fields] = m;
      nested.push({
        alias: alias || table,
        table,
        fk: fk || undefined,
        fields: fields.split(",").map((f) => f.trim()).filter(Boolean),
      });
    } else {
      columns.push(p);
    }
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
  const guessOne = `${singular(part.table)}_id`;
  if (sample && guessOne in sample) return { table: part.table, fk: guessOne, type: "one" };
  const guessAlias = `${part.alias}_id`;
  if (sample && guessAlias in sample) return { table: part.table, fk: guessAlias, type: "one" };
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

async function fetchByIds(table: string, ids: string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  const fs = fbFirestore();
  for (const part of chunk(ids, 30)) {
    const snap = await getDocs(query(collection(fs, table), where(documentId(), "in", part)));
    snap.forEach((d) => map.set(d.id, plain(d.id, d.data())));
  }
  return map;
}

async function fetchByFk(table: string, fk: string, ids: string[]): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  const fs = fbFirestore();
  for (const part of chunk(ids, 30)) {
    const snap = await getDocs(query(collection(fs, table), where(fk, "in", part)));
    snap.forEach((d) => {
      const row = plain(d.id, d.data());
      const key = String(row[fk]);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    });
  }
  return map;
}

async function hydrate(parentTable: string, rows: Row[], nested: SelectPart[]): Promise<void> {
  if (!rows.length || !nested.length) return;
  for (const part of nested) {
    const rel = resolveRel(parentTable, part, rows[0]);
    if (rel.type === "one") {
      const ids = Array.from(
        new Set(rows.map((r) => r[rel.fk]).filter((v): v is string => typeof v === "string" && !!v)),
      );
      const map = ids.length ? await fetchByIds(rel.table, ids) : new Map<string, Row>();
      for (const r of rows) {
        const target = r[rel.fk] ? map.get(String(r[rel.fk])) : undefined;
        r[part.alias] = target ? pick(target, part.fields) : null;
      }
    } else {
      const ids = rows.map((r) => String(r.id));
      const map = await fetchByFk(rel.table, rel.fk, ids);
      for (const r of rows) {
        r[part.alias] = (map.get(String(r.id)) ?? []).map((c) => pick(c, part.fields));
      }
    }
  }
}

/* ----------------------------------------------------------------- запросы */

type FilterOp = "eq" | "neq" | "in" | "gte" | "lte" | "gt" | "lt" | "isnull" | "notnull";
type Filter = { op: FilterOp; field: string; value?: any };

type Result<T = any> = { data: T; error: any; count?: number };

class Builder implements PromiseLike<Result> {
  private table: string;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selectSpec = "*";
  private filters: Filter[] = [];
  private orders: { field: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private payload: Row[] = [];
  private onConflict: string[] = [];
  private wantSingle: "one" | "maybe" | null = null;
  private headOnly = false;
  private wantCount = false;
  private returnRows = false;

  constructor(table: string) {
    this.table = table;
  }

  select(spec = "*", opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") this.selectSpec = spec;
    else this.returnRows = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = [payload];
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.onConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(field: string, value: any) {
    this.filters.push({ op: "eq", field, value });
    return this;
  }
  neq(field: string, value: any) {
    this.filters.push({ op: "neq", field, value });
    return this;
  }
  in(field: string, values: any[]) {
    this.filters.push({ op: "in", field, value: values });
    return this;
  }
  gte(field: string, value: any) {
    this.filters.push({ op: "gte", field, value });
    return this;
  }
  lte(field: string, value: any) {
    this.filters.push({ op: "lte", field, value });
    return this;
  }
  gt(field: string, value: any) {
    this.filters.push({ op: "gt", field, value });
    return this;
  }
  lt(field: string, value: any) {
    this.filters.push({ op: "lt", field, value });
    return this;
  }
  is(field: string, value: null | boolean) {
    this.filters.push(value === null ? { op: "isnull", field } : { op: "eq", field, value });
    return this;
  }
  not(field: string, op: string, value: any) {
    if (op === "is" && value === null) this.filters.push({ op: "notnull", field });
    else this.filters.push({ op: "neq", field, value });
    return this;
  }
  order(field: string, opts?: { ascending?: boolean }) {
    this.orders.push({ field, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.wantSingle = "one";
    return this;
  }
  maybeSingle() {
    this.wantSingle = "maybe";
    return this;
  }

  private constraints(): QueryConstraint[] {
    const cs: QueryConstraint[] = [];
    for (const f of this.filters) {
      if (f.op === "eq" && f.value !== null && f.value !== undefined) {
        cs.push(where(f.field, "==", f.value));
      }
    }
    return cs;
  }

  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const v = row[f.field];
      switch (f.op) {
        case "eq":
          if (f.value === null || f.value === undefined) {
            if (v !== null && v !== undefined) return false;
          }
          break;
        case "neq":
          if (v === f.value) return false;
          break;
        case "in":
          if (!(f.value as any[]).includes(v)) return false;
          break;
        case "gte":
          if (!(cmp(v, f.value) >= 0)) return false;
          break;
        case "lte":
          if (!(cmp(v, f.value) <= 0)) return false;
          break;
        case "gt":
          if (!(cmp(v, f.value) > 0)) return false;
          break;
        case "lt":
          if (!(cmp(v, f.value) < 0)) return false;
          break;
        case "isnull":
          if (v !== null && v !== undefined && v !== "") return false;
          break;
        case "notnull":
          if (v === null || v === undefined || v === "") return false;
          break;
      }
    }
    return true;
  }

  private async load(): Promise<Row[]> {
    const fs = fbFirestore();
    const snap = await getDocs(query(collection(fs, this.table), ...this.constraints()));
    const rows: Row[] = [];
    snap.forEach((d) => {
      const row = plain(d.id, d.data());
      if (this.matches(row)) rows.push(row);
    });
    return rows;
  }

  private sortSlice(rows: Row[]): Row[] {
    if (this.orders.length) {
      rows.sort((a, b) => {
        for (const o of this.orders) {
          const c = cmp(a[o.field], b[o.field]);
          if (c !== 0) return o.asc ? c : -c;
        }
        return 0;
      });
    }
    let out = rows;
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      out = out.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }

  private async run(): Promise<Result> {
    const fs = fbFirestore();
    try {
      if (this.mode === "select") {
        const rows = this.sortSlice(await this.load());
        if (this.headOnly) return { data: null, error: null, count: rows.length };
        const { columns, nested } = parseSelect(this.selectSpec);
        await hydrate(this.table, rows, nested);
        const shaped =
          columns.includes("*") || columns.length === 0
            ? rows
            : rows.map((r) => {
                const out: Row = { id: r.id };
                for (const c of columns) out[c] = r[c] ?? null;
                for (const n of nested) out[n.alias] = r[n.alias];
                return out;
              });
        if (this.wantSingle) {
          if (!shaped.length) {
            return this.wantSingle === "one"
              ? { data: null, error: { message: "Запись не найдена" } }
              : { data: null, error: null };
          }
          return { data: shaped[0], error: null };
        }
        return { data: shaped, error: null, count: this.wantCount ? rows.length : undefined };
      }

      if (this.mode === "insert" || this.mode === "upsert") {
        const created: Row[] = [];
        let existing: Row[] = [];
        if (this.mode === "upsert") {
          // Ищем существующие записи по ключу конфликта.
          const keyFields = this.onConflict;
          const anchor = keyFields.find((f) => f !== "id") ?? "id";
          const values = Array.from(new Set(this.payload.map((p) => p[anchor]).filter((v) => v !== undefined)));
          for (const part of chunk(values, 30)) {
            const snap = await getDocs(query(collection(fs, this.table), where(anchor, "in", part)));
            snap.forEach((d) => existing.push(plain(d.id, d.data())));
          }
        }
        const keyOf = (r: Row) => this.onConflict.map((f) => String(r[f] ?? "")).join("\u0001");
        const index = new Map(existing.map((r) => [keyOf(r), r]));

        for (const group of chunk(this.payload, 400)) {
          const batch = writeBatch(fs);
          for (const item of group) {
            const found = this.mode === "upsert" ? index.get(keyOf(item)) : undefined;
            if (found) {
              const refDoc = doc(fs, this.table, String(found.id));
              batch.set(refDoc, { ...item, id: found.id, updated_at: new Date().toISOString() }, { merge: true });
              created.push({ ...found, ...item, id: found.id });
            } else {
              const refDoc = item.id ? doc(fs, this.table, String(item.id)) : doc(collection(fs, this.table));
              const body = {
                created_at: new Date().toISOString(),
                ...item,
                id: refDoc.id,
              };
              batch.set(refDoc, body, { merge: true });
              created.push(body);
            }
          }
          await batch.commit();
        }
        if (this.wantSingle) return { data: created[0] ?? null, error: null };
        return { data: created, error: null };
      }

      if (this.mode === "update") {
        const rows = await this.load();
        const patch = { ...this.payload[0], updated_at: new Date().toISOString() };
        for (const group of chunk(rows, 400)) {
          const batch = writeBatch(fs);
          for (const r of group) batch.set(doc(fs, this.table, String(r.id)), patch, { merge: true });
          await batch.commit();
        }
        const updated = rows.map((r) => ({ ...r, ...patch }));
        if (this.wantSingle) return { data: updated[0] ?? null, error: null };
        return { data: updated, error: null };
      }

      // delete
      const rows = await this.load();
      for (const group of chunk(rows, 400)) {
        const batch = writeBatch(fs);
        for (const r of group) batch.delete(doc(fs, this.table, String(r.id)));
        await batch.commit();
      }
      return { data: rows, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled as any, onrejected as any);
  }
}

/* ---------------------------------------------------------------- аутентификация */

type AuthUser = { id: string; email: string | null; user_metadata: Row } | null;

function toAuthUser(u: User | null): AuthUser {
  if (!u) return null;
  return { id: u.uid, email: u.email, user_metadata: { name: u.displayName ?? "" } };
}

let authReady: Promise<void> | null = null;
function waitAuth(): Promise<void> {
  if (!authReady) {
    authReady = new Promise<void>((resolve) => {
      const un = onAuthStateChanged(fbAuth(), () => {
        un();
        resolve();
      });
    });
  }
  return authReady;
}

export const auth = {
  async getUser() {
    await waitAuth();
    return { data: { user: toAuthUser(fbAuth().currentUser) }, error: null };
  },
  async getSession() {
    await waitAuth();
    const user = toAuthUser(fbAuth().currentUser);
    return { data: { session: user ? { user, access_token: await fbAuth().currentUser!.getIdToken() } : null }, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const cred = await signInWithEmailAndPassword(fbAuth(), email, password);
      return { data: { user: toAuthUser(cred.user) }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: humanAuthError(e) } };
    }
  },
  async signUp({ email, password }: { email: string; password: string; options?: any }) {
    try {
      const cred = await createUserWithEmailAndPassword(fbAuth(), email, password);
      return { data: { user: toAuthUser(cred.user) }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: humanAuthError(e) } };
    }
  },
  async signOut() {
    await signOut(fbAuth());
    return { error: null };
  },
  async resetPasswordForEmail(email: string) {
    try {
      await sendPasswordResetEmail(fbAuth(), email);
      return { error: null };
    } catch (e: any) {
      return { error: { message: humanAuthError(e) } };
    }
  },
  async updateUser({ password }: { password: string }) {
    const u = fbAuth().currentUser;
    if (!u) return { error: { message: "Нет активного входа" } };
    try {
      await updatePassword(u, password);
      return { error: null };
    } catch (e: any) {
      return { error: { message: humanAuthError(e) } };
    }
  },
  onAuthStateChange(cb: (event: string, session: any) => void) {
    const un = onIdTokenChanged(fbAuth(), (u) => {
      const user = toAuthUser(u);
      cb(user ? "SIGNED_IN" : "SIGNED_OUT", user ? { user } : null);
    });
    return { data: { subscription: { unsubscribe: un } } };
  },
};

function humanAuthError(e: any): string {
  const code = String(e?.code ?? "");
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Неверный e-mail или пароль";
  if (code.includes("user-not-found")) return "Пользователь не найден";
  if (code.includes("email-already-in-use")) return "Этот e-mail уже зарегистрирован";
  if (code.includes("weak-password")) return "Слишком короткий пароль (минимум 6 символов)";
  if (code.includes("too-many-requests")) return "Слишком много попыток, попробуйте позже";
  if (code.includes("operation-not-allowed")) return "Вход по e-mail отключён в Firebase";
  if (code.includes("requires-recent-login")) return "Требуется повторный вход";
  return e?.message ?? "Ошибка входа";
}

/* --------------------------------------------------------------------- файлы */

const storage = {
  from(bucket: string) {
    return {
      async upload(path: string, file: Blob, opts?: { contentType?: string }) {
        try {
          const r = storageRef(fbStorage(), `${bucket}/${path}`);
          await uploadBytes(r, file, opts?.contentType ? { contentType: opts.contentType } : undefined);
          return { data: { path }, error: null };
        } catch (e: any) {
          return { data: null, error: { message: e?.message ?? String(e) } };
        }
      },
      async getUrl(path: string) {
        try {
          const url = await getDownloadURL(storageRef(fbStorage(), `${bucket}/${path}`));
          return { data: { publicUrl: url }, error: null };
        } catch (e: any) {
          return { data: { publicUrl: "" }, error: { message: e?.message ?? String(e) } };
        }
      },
      async remove(paths: string[]) {
        return { data: paths, error: null };
      },
    };
  },
};

/* ---------------------------------------------------------------- публичное API */

export const db = {
  from: (table: string) => new Builder(table),
  auth,
  storage,
  /** Прямое чтение одного документа. */
  async getById(table: string, id: string) {
    const snap = await getDoc(doc(fbFirestore(), table, id));
    return snap.exists() ? plain(snap.id, snap.data()) : null;
  },
};

export type Db = typeof db;
