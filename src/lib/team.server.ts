// Работа командой: роли, участники базы, приглашения, история изменений.
import { randomBytes } from "node:crypto";
import { sql } from "./pg.server";

export type Role = "owner" | "manager" | "storekeeper" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  storekeeper: "Кладовщик",
  viewer: "Наблюдатель",
};

/** Таблицы, которые кладовщик может менять. */
const STOREKEEPER_TABLES = new Set([
  "products",
  "product_folders",
  "product_types",
  "stock_movements",
  "stock_receipts",
  "stock_receipt_items",
  "warehouses",
  "units",
]);

/** Таблицы, которые может менять только владелец базы. */
const OWNER_ONLY_TABLES = new Set(["workspaces", "workspace_members", "organizations"]);

/** Все базы, доступные пользователю: свои + те, где он участник. */
export async function accessibleWorkspaces(userId: string): Promise<string[]> {
  const s = sql();
  const rows = await s`
    select id from workspaces where user_id = ${userId}
    union
    select workspace_id as id from workspace_members where user_id = ${userId} and workspace_id is not null
  `;
  return rows.map((r: any) => r.id as string);
}

/** Роль пользователя в базе (null — доступа нет). */
export async function roleIn(userId: string, workspaceId: string | null): Promise<Role | null> {
  if (!workspaceId) return "owner";
  const s = sql();
  const own = await s`select 1 from workspaces where id = ${workspaceId} and user_id = ${userId} limit 1`;
  if (own.length) return "owner";
  const m = await s`
    select data->>'role' as role from workspace_members
    where workspace_id = ${workspaceId} and user_id = ${userId} limit 1
  `;
  const role = (m[0] as any)?.role as Role | undefined;
  return role ?? null;
}

/** Может ли пользователь менять данные в таблице этой базы. */
export function canWrite(role: Role, table: string): boolean {
  if (role === "owner") return true;
  if (role === "viewer") return false;
  if (OWNER_ONLY_TABLES.has(table)) return false;
  if (role === "storekeeper") return STOREKEEPER_TABLES.has(table);
  return true; // manager
}

/* ------------------------------------------------------- история изменений */

const LOGGED_TABLES = new Set([
  "invoices",
  "invoice_items",
  "invoice_payments",
  "products",
  "partners",
  "stock_movements",
  "stock_receipts",
]);

export async function logChange(opts: {
  table: string;
  docId: string | null;
  workspaceId: string | null;
  userId: string;
  userEmail: string;
  op: "insert" | "update" | "delete";
  changes?: Record<string, unknown>;
}) {
  if (!LOGGED_TABLES.has(opts.table)) return;
  const s = sql();
  try {
    await s`
      insert into document_log (workspace_id, doc_table, doc_id, user_id, user_email, op, changes)
      values (${opts.workspaceId}, ${opts.table}, ${opts.docId}, ${opts.userId}, ${opts.userEmail},
              ${opts.op}, ${s.json((opts.changes ?? {}) as any)})
    `;
  } catch {
    /* история не должна ломать основную операцию */
  }
}

export async function docHistory(table: string, docId: string, limit = 50) {
  const s = sql();
  const rows = await s`
    select id, doc_table, doc_id, user_email, op, changes, created_at
    from document_log
    where doc_table = ${table} and doc_id = ${docId}
    order by created_at desc
    limit ${limit}
  `;
  return rows as any[];
}

export async function workspaceHistory(workspaceId: string, limit = 200) {
  const s = sql();
  const rows = await s`
    select id, doc_table, doc_id, user_email, op, changes, created_at
    from document_log
    where workspace_id = ${workspaceId}
    order by created_at desc
    limit ${limit}
  `;
  return rows as any[];
}

/* ------------------------------------------------------------- участники */

export async function listMembers(workspaceId: string) {
  const s = sql();
  const members = await s`
    select m.id, m.user_id, m.data, m.created_at, u.email as user_email, u.name as user_name
    from workspace_members m
    left join app_users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}
    order by m.created_at asc
  `;
  const owner = await s`
    select u.id, u.email, u.name from workspaces w
    join app_users u on u.id = w.user_id where w.id = ${workspaceId} limit 1
  `;
  const invites = await s`
    select token, email, role, created_at, expires_at from workspace_invites
    where workspace_id = ${workspaceId} and accepted_at is null and expires_at > now()
    order by created_at desc
  `;
  return {
    owner: owner.length
      ? { id: (owner[0] as any).id, email: (owner[0] as any).email, name: (owner[0] as any).name ?? "" }
      : null,
    members: (members as any[]).map((m) => ({
      id: m.id as string,
      user_id: m.user_id as string,
      email: (m.user_email as string) ?? (m.data?.email as string) ?? "",
      name: (m.user_name as string) ?? "",
      role: ((m.data?.role as Role) ?? "manager") as Role,
      organization_id: (m.data?.organization_id as string | undefined) ?? null,
      created_at: m.created_at,
    })),
    invites: (invites as any[]).map((i) => ({
      token: i.token as string,
      email: i.email as string,
      role: i.role as Role,
      expires_at: i.expires_at,
    })),
  };
}

export async function createInvite(opts: {
  workspaceId: string;
  email: string;
  role: Role;
  invitedBy: string;
}): Promise<{ token: string; existingUser: boolean }> {
  const s = sql();
  const email = opts.email.trim();
  if (!email.includes("@")) throw new Error("Укажите корректный e-mail");
  const user = await s`select id from app_users where lower(email) = lower(${email}) limit 1`;
  if (user.length) {
    const uid = (user[0] as any).id as string;
    const owner = await s`select 1 from workspaces where id = ${opts.workspaceId} and user_id = ${uid} limit 1`;
    if (owner.length) throw new Error("Это владелец базы");
    await s`
      insert into workspace_members (id, workspace_id, user_id, data)
      values (${crypto.randomUUID()}, ${opts.workspaceId}, ${uid},
              ${s.json({ email, role: opts.role } as any)})
      on conflict (workspace_id, user_id)
      do update set data = workspace_members.data || excluded.data, updated_at = now()
    `;
    return { token: "", existingUser: true };
  }
  const token = randomBytes(24).toString("hex");
  await s`
    insert into workspace_invites (token, workspace_id, email, role, invited_by, expires_at)
    values (${token}, ${opts.workspaceId}, ${email}, ${opts.role}, ${opts.invitedBy}, now() + interval '14 days')
  `;
  return { token, existingUser: false };
}

export async function setMemberRole(workspaceId: string, memberId: string, role: Role) {
  const s = sql();
  await s`
    update workspace_members set data = data || ${s.json({ role } as any)}, updated_at = now()
    where id = ${memberId} and workspace_id = ${workspaceId}
  `;
}

export async function removeMember(workspaceId: string, memberId: string) {
  const s = sql();
  await s`delete from workspace_members where id = ${memberId} and workspace_id = ${workspaceId}`;
}

export async function revokeInvite(workspaceId: string, token: string) {
  const s = sql();
  await s`delete from workspace_invites where token = ${token} and workspace_id = ${workspaceId}`;
}

/** После входа/регистрации: принять все приглашения на этот e-mail. */
export async function acceptInvitesFor(userId: string, email: string) {
  const s = sql();
  const rows = await s`
    select token, workspace_id, role from workspace_invites
    where lower(email) = lower(${email}) and accepted_at is null and expires_at > now()
  `;
  for (const r of rows as any[]) {
    await s`
      insert into workspace_members (id, workspace_id, user_id, data)
      values (${crypto.randomUUID()}, ${r.workspace_id}, ${userId},
              ${s.json({ email, role: r.role } as any)})
      on conflict (workspace_id, user_id)
      do update set data = workspace_members.data || excluded.data, updated_at = now()
    `;
    await s`update workspace_invites set accepted_at = now() where token = ${r.token}`;
  }
}

/** Список баз с ролью — для переключателя баз. */
export async function myWorkspaces(userId: string) {
  const s = sql();
  const rows = await s`
    select w.id, w.data->>'name' as name, w.created_at,
           case when w.user_id = ${userId} then 'owner' else coalesce(m.data->>'role', 'manager') end as role,
           (w.user_id = ${userId}) as is_owner
    from workspaces w
    left join workspace_members m on m.workspace_id = w.id and m.user_id = ${userId}
    where w.user_id = ${userId} or m.user_id = ${userId}
    order by w.created_at asc
  `;
  return (rows as any[]).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "База",
    role: r.role as Role,
    is_owner: !!r.is_owner,
  }));
}

/** Привязать логин сотрудника к юрлицу (null — без привязки). */
export async function setMemberOrg(workspaceId: string, memberId: string, orgId: string | null) {
  const s = sql();
  if (orgId) {
    await s`
      update workspace_members set data = data || ${s.json({ organization_id: orgId } as any)}, updated_at = now()
      where id = ${memberId} and workspace_id = ${workspaceId}
    `;
  } else {
    await s`
      update workspace_members set data = data - 'organization_id', updated_at = now()
      where id = ${memberId} and workspace_id = ${workspaceId}
    `;
  }
}

/**
 * Авторы документов базы: doc_id → e-mail того, кто создал документ.
 * Берём самую раннюю запись истории с операцией insert.
 */
export async function docAuthors(workspaceId: string, table = "invoices") {
  const s = sql();
  const rows = await s`
    select doc_id, min(user_email) as user_email
    from document_log
    where workspace_id = ${workspaceId} and doc_table = ${table} and op = 'insert'
    group by doc_id
  `;
  return rows as { doc_id: string; user_email: string | null }[];
}
