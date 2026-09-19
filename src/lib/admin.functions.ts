// Серверные функции админки. Доступны только пользователю с признаком администратора.
import { createServerFn } from "@tanstack/react-start";

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
      order by w.name`;
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
  .inputValidator((input: { email: string; password: string; name?: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { requireAdmin, hashPassword } = await import("./auth.server");
      await requireAdmin();
      if (!data.email.includes("@")) throw new Error("Укажите корректный email");
      if (data.password.length < 6) throw new Error("Пароль не короче 6 символов");
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
  .inputValidator((input: { userId: string; password: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { requireAdmin, hashPassword } = await import("./auth.server");
      await requireAdmin();
      if (data.password.length < 6) throw new Error("Пароль не короче 6 символов");
      const { sql } = await import("./pg.server");
      const s = sql();
      await s`update app_users set password_hash = ${hashPassword(data.password)} where id = ${data.userId}`;
      await s`delete from app_sessions where user_id = ${data.userId}`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

export const adminSetAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string; isAdmin: boolean }) => input)
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

export const adminDeleteUser = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { requireAdmin } = await import("./auth.server");
      const me = await requireAdmin();
      if (me.id === data.userId) throw new Error("Нельзя удалить себя");
      const { sql } = await import("./pg.server");
      const s = sql();
      const ws = await s`select count(*) from workspaces where user_id = ${data.userId}`;
      if (Number((ws[0] as any)?.count ?? 0) > 0) {
        throw new Error("У пользователя есть базы с данными — сначала передайте или удалите их");
      }
      await s`delete from app_sessions where user_id = ${data.userId}`;
      await s`delete from password_resets where user_id = ${data.userId}`;
      await s`delete from app_users where id = ${data.userId}`;
      return { data: { ok: true }, error: null };
    } catch (e) {
      return fail(e);
    }
  });

/** Только чтение: один SELECT, максимум 200 строк. */
export const adminSelect = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string }) => input)
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
      const { sql } = await import("./pg.server");
      const s = sql();
      const rows = await s.unsafe(`select * from (${q}) as sub limit 200`);
      return { data: rows as any[], error: null };
    } catch (e) {
      return fail(e);
    }
  });
