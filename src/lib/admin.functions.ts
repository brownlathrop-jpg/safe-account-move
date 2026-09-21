// Серверные функции админки. Доступны только пользователю с признаком администратора.
import { createServerFn } from "@tanstack/react-start";
import * as V from "./validate";

function fail(e: any) {
  return { data: null, error: { message: e?.message ?? String(e) } };
}

export const adminListUsers = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { requireAdmin } = await import("./auth.server");
    await requireAdmin();
    const { sql } = await import("./pg.server");
    const s = sql();
    const rows = await s`
      select u.id, u.email, u.name, u.is_admin, u.created_at,
             (select count(*) from workspaces w where w.user_id = u.id::text) as workspaces,
             (select count(*) from products p where p.user_id = u.id::text) as products
      from app_users u
      order by u.created_at`;
    return { data: rows as any[], error: null };
  } catch (e) {
    return fail(e);
  }
});

export const adminStats = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { requireAdmin } = await import("./auth.server");
    await requireAdmin();
    const { sql } = await import("./pg.server");
    const s = sql();
    const counts = await s`
      select 'Товары и услуги' as label, count(*) from products
      union all select 'Папки товаров', count(*) from product_folders
      union all select 'Контрагенты', count(*) from partners
      union all select 'Документы', count(*) from invoices
      union all select 'Строки документов', count(*) from invoice_items
      union all select 'Движения по складу', count(*) from stock_movements
      union all select 'Поступления на склад', count(*) from stock_receipts
      union all select 'Базы', count(*) from workspaces
      union all select 'Пользователи', count(*) from app_users`;
    const size = await s`select pg_size_pretty(pg_database_size(current_database())) as size`;
    // Сессии входа хранятся в зашифрованных куках, таблица app_sessions не используется.
    // Вместо «активных сессий» показываем неудачные попытки входа за сутки.
    const sessions = await s`
      select count(*) from auth_attempts
      where not ok and created_at > now() - interval '24 hours'`;
    // Разбивка по базам (workspaces)
    const byWorkspace = await s`
      select w.id, coalesce(w.data->>'name', 'Без названия') as name, u.email as owner,
             (select count(*) from products p where p.workspace_id = w.id) as products,
             (select count(*) from product_folders f where f.workspace_id = w.id) as folders,
             (select count(*) from partners pt where pt.workspace_id = w.id) as partners,
             (select count(*) from invoices i where i.workspace_id = w.id) as invoices,
             (select count(*) from invoice_items ii where ii.workspace_id = w.id) as invoice_items,
             (select count(*) from stock_movements sm where sm.workspace_id = w.id) as stock_movements,
             (select count(*) from stock_receipts sr where sr.workspace_id = w.id) as stock_receipts
      from workspaces w
      left join app_users u on u.id::text = w.user_id
      order by w.data->>'name'`;
    return {
      data: {
        counts: counts as any[],
        byWorkspace: byWorkspace as any[],
        size: (size[0] as any)?.size ?? "",
        sessions: Number((sessions[0] as any)?.count ?? 0),
      },
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
});

export const adminCreateUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminCreateUserSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin, hashPassword } = await import("./auth.server");
      await requireAdmin();
      // длина пароля проверена схемой adminCreateUserSchema
      const { sql } = await import("./pg.server");
      const s = sql();
      const exists = await s`select 1 from app_users where lower(email) = lower(${data.email}) limit 1`;
      if (exists.length) throw new Error("Такой email уже есть");
      await s`
        insert into app_users (email, password_hash, name)
        values (${data.email}, ${hashPassword(data.password)}, ${data.name ?? ""})`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

export const adminSetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminUserPasswordSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin, hashPassword, revokeSessions } = await import("./auth.server");
      await requireAdmin();
      // длина пароля проверена схемой adminUserPasswordSchema
      const { sql } = await import("./pg.server");
      const s = sql();
      await s`update app_users set password_hash = ${hashPassword(data.password)} where id = ${data.userId}`;
      // все прежние входы этого пользователя перестают действовать
      await revokeSessions(data.userId);
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

export const adminSetAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminUserFlagSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin } = await import("./auth.server");
      const me = await requireAdmin();
      if (me.id === data.userId && !data.isAdmin) throw new Error("Нельзя снять права с себя");
      const { sql } = await import("./pg.server");
      const s = sql();
      await s`update app_users set is_admin = ${data.isAdmin} where id = ${data.userId}`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

/** Передать базу другому пользователю (иначе владельца базы невозможно удалить). */
export const adminTransferWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminTransferSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin } = await import("./auth.server");
      await requireAdmin();
      const { sql } = await import("./pg.server");
      const s = sql();
      const target = await s`select id, email from app_users where id = ${data.userId} limit 1`;
      if (!target.length) throw new Error("Пользователь не найден");
      const ws = await s`select id, user_id from workspaces where id = ${data.workspaceId} limit 1`;
      if (!ws.length) throw new Error("База не найдена");
      const oldOwner = (ws[0] as any).user_id as string | null;
      await s`update workspaces set user_id = ${data.userId}, updated_at = now() where id = ${data.workspaceId}`;
      // прежний владелец остаётся участником с правами менеджера, если он ещё есть
      if (oldOwner && oldOwner !== data.userId) {
        await s`
          insert into workspace_members (id, workspace_id, user_id, data)
          values (${crypto.randomUUID()}, ${data.workspaceId}, ${oldOwner},
                  ${s.json({ role: "manager" } as any)})
          on conflict (workspace_id, user_id) do nothing`;
      }
      // новый владелец не должен числиться ещё и участником
      await s`
        delete from workspace_members
         where workspace_id = ${data.workspaceId} and user_id = ${data.userId}`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminUserSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin, revokeSessions } = await import("./auth.server");
      const me = await requireAdmin();
      if (me.id === data.userId) throw new Error("Нельзя удалить себя");
      const { sql } = await import("./pg.server");
      const s = sql();
      const ws = await s`select count(*) from workspaces where user_id = ${data.userId}`;
      if (Number((ws[0] as any)?.count ?? 0) > 0) {
        throw new Error("У пользователя есть свои базы — сначала передайте их другому пользователю");
      }
      // отзываем входы и чистим все следы участия
      await revokeSessions(data.userId);
      await s`delete from workspace_members where user_id = ${data.userId}`;
      await s`delete from workspace_invites where invited_by = ${data.userId}`;
      await s`delete from document_log where user_id = ${data.userId}`;
      await s`delete from app_sessions where user_id = ${data.userId}`;
      await s`delete from password_resets where user_id = ${data.userId}`;
      await s`delete from app_users where id = ${data.userId}`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

/** Разрешённые для чтения таблицы админского запроса. */
const READABLE_TABLES = new Set([
  "app_users", "auth_attempts", "workspaces", "workspace_members", "workspace_invites",
  "document_log", "products", "product_folders", "product_types", "partners",
  "invoices", "invoice_items", "invoice_payments", "invoice_statuses", "warehouses",
  "stock_movements", "stock_receipts", "stock_receipt_items", "cashflow_items",
  "organizations", "bank_accounts", "banks", "price_types", "units", "discounts",
  "files", "schema_migrations", "password_resets",
]);

/** Только чтение: один SELECT по разрешённым таблицам, максимум 200 строк. */
export const adminSelect = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminQuerySchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireAdmin } = await import("./auth.server");
      await requireAdmin();
      const q = data.query.trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\s/i.test(q)) throw new Error("Разрешены только запросы SELECT");
      if (q.includes(";")) throw new Error("Только один запрос за раз");
      if (/\b(insert|update|delete|drop|alter|create|truncate|grant|copy)\b/i.test(q)) {
        throw new Error("Разрешено только чтение данных");
      }
      // белый список: любые обращения к функциям и служебным объектам отсекаются
      const names = Array.from(q.matchAll(/\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi)).map(
        (m) => String(m[1]).toLowerCase().replace(/^public\./, ""),
      );
      const bad = names.filter((n) => !READABLE_TABLES.has(n));
      if (bad.length) throw new Error(`Недоступные таблицы: ${bad.join(", ")}`);
      if (/\(\s*\)|pg_read_file|pg_ls_dir|lo_import|dblink|set_config|pg_sleep/i.test(q)) {
        throw new Error("В запросе нельзя вызывать функции");
      }
      const { sql } = await import("./pg.server");
      const s = sql();
      const rows = await s.begin(async (tx) => {
        await tx.unsafe("set transaction read only");
        return tx.unsafe(`select * from (${q}) as sub limit 200`);
      });
      return { data: rows as any[], error: null };
    } catch (e) {
      return fail(e);
    }
  });
