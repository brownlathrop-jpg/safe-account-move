/**
 * Слой доступа к данным на PostgreSQL (своя база на сервере).
 *
 * Интерфейс тот же, что использовался раньше:
 * `db.from("products").select(...).eq(...).order(...)`.
 * Все запросы уходят на сервер (серверные функции), браузер к базе не ходит.
 */
import {
  authChangePassword,
  authMe,
  authRequestReset,
  authResetPassword,
  authSignIn,
  authSignOut,
  authSignUp,
  dbGetById,
  dbQuery,
  storageRemove,
  storageUpload,
} from "@/lib/db.functions";

type Row = Record<string, any>;
type Result = { data: any; error: any; count?: number };

type FilterOp = "eq" | "neq" | "in" | "gte" | "lte" | "gt" | "lt" | "isnull" | "notnull";

class Builder implements PromiseLike<Result> {
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectSpec = "*";
  private filters: { op: FilterOp; field: string; value?: any }[] = [];
  private orders: { field: string; asc: boolean }[] = [];
  private limitValue: number | null = null;
  private rangeValue: { from: number; to: number } | null = null;
  private payload: Row[] = [];
  private onConflict: string[] = ["id"];
  private wantSingle: "one" | "maybe" | null = null;
  private wantCount = false;
  private headOnly = false;

  constructor(private table: string) {}

  select(spec = "*", opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") this.selectSpec = spec || "*";
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
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
    if (value === null) this.filters.push({ op: "isnull", field });
    else this.filters.push({ op: "eq", field, value });
    return this;
  }
  not(field: string, _op: string, value: any) {
    if (value === null) this.filters.push({ op: "notnull", field });
    else this.filters.push({ op: "neq", field, value });
    return this;
  }
  order(field: string, opts?: { ascending?: boolean }) {
    this.orders.push({ field, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitValue = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeValue = { from, to };
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

  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    if (opts?.onConflict) this.onConflict = opts.onConflict.split(",").map((s) => s.trim());
    return this;
  }
  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  private async run(): Promise<Result> {
    try {
      const res = (await dbQuery({
        data: {
          table: this.table,
          mode: this.mode,
          select: this.selectSpec,
          filters: this.filters,
          orders: this.orders,
          limit: this.limitValue,
          range: this.rangeValue,
          payload: this.payload,
          onConflict: this.onConflict,
          single: this.wantSingle,
          head: this.headOnly,
          count: this.wantCount,
        },
      })) as Result;
      return res;
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

/* ------------------------------------------------------------------- вход */

type AuthUser = { id: string; email: string | null; user_metadata: Row } | null;

let cached: AuthUser = null;
let loaded = false;
const listeners = new Set<(event: string, session: any) => void>();

function notify() {
  for (const cb of listeners) cb(cached ? "SIGNED_IN" : "SIGNED_OUT", cached ? { user: cached } : null);
}

async function loadUser(force = false): Promise<AuthUser> {
  if (loaded && !force) return cached;
  const res: any = await authMe({ data: undefined as any } as any).catch(() => ({ user: null }));
  const u = res?.user ?? null;
  cached = u
    ? { id: u.id, email: u.email, user_metadata: { name: u.name ?? "", is_admin: !!u.is_admin } }
    : null;
  loaded = true;
  return cached;
}

export const auth = {
  async getUser() {
    return { data: { user: await loadUser() }, error: null };
  },
  async getSession() {
    const user = await loadUser();
    return { data: { session: user ? { user, access_token: "cookie" } : null }, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const res: any = await authSignIn({ data: { email, password } });
    if (res.error) return { data: null, error: res.error };
    cached = { id: res.user.id, email: res.user.email, user_metadata: { name: res.user.name ?? "", is_admin: !!res.user.is_admin } };
    loaded = true;
    notify();
    return { data: { user: cached }, error: null };
  },
  async signUp({ email, password }: { email: string; password: string; options?: any }) {
    const res: any = await authSignUp({ data: { email, password } });
    if (res.error) return { data: null, error: res.error };
    cached = { id: res.user.id, email: res.user.email, user_metadata: { name: res.user.name ?? "", is_admin: !!res.user.is_admin } };
    loaded = true;
    notify();
    return { data: { user: cached }, error: null };
  },
  async signOut() {
    await authSignOut({ data: undefined as any } as any);
    cached = null;
    loaded = true;
    notify();
    return { error: null };
  },
  async resetPasswordForEmail(email: string) {
    const res: any = await authRequestReset({ data: { email } });
    return { error: res.error ?? null };
  },
  async resetPasswordWithToken(token: string, password: string) {
    const res: any = await authResetPassword({ data: { token, password } });
    return { error: res.error ?? null };
  },
  async updateUser({ password }: { password: string }) {
    const res: any = await authChangePassword({ data: { password } });
    return { error: res.error ?? null };
  },
  onAuthStateChange(cb: (event: string, session: any) => void) {
    listeners.add(cb);
    void loadUser().then(() => cb(cached ? "SIGNED_IN" : "SIGNED_OUT", cached ? { user: cached } : null));
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
};

/* ----------------------------------------------------------------- файлы */

async function blobToBase64(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Активная база из localStorage (без импорта workspace.ts — иначе круг зависимостей). */
function activeWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("active-workspace-id");
  } catch {
    return null;
  }
}

const storage = {
  from(bucket: string) {
    return {
      async upload(path: string, file: Blob, opts?: { contentType?: string }) {
        try {
          const base64 = await blobToBase64(file);
          const res: any = await storageUpload({
            data: {
              bucket,
              path,
              contentType: opts?.contentType ?? file.type ?? "application/octet-stream",
              base64,
              workspaceId: activeWorkspaceId(),
            },
          });
          if (res.error) return { data: null, error: res.error };
          return { data: { path }, error: null };
        } catch (e: any) {
          return { data: null, error: { message: e?.message ?? String(e) } };
        }
      },
      async getUrl(path: string) {
        return { data: { publicUrl: `/api/file/${path}` }, error: null };
      },
      async remove(paths: string[]) {
        const res: any = await storageRemove({
          data: { bucket, paths, workspaceId: activeWorkspaceId() },
        });
        return { data: paths, error: res.error ?? null };
      },
    };
  },
};

export const db = {
  from: (table: string) => new Builder(table),
  auth,
  storage,
  async getById(table: string, id: string) {
    const res: any = await dbGetById({ data: { table, id } });
    return res?.data ?? null;
  },
};

export type Db = typeof db;
