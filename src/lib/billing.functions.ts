// Серверные функции: тарифы, оплата доступа, карточка клиента в админке.
import { createServerFn } from "@tanstack/react-start";
import * as V from "./validate";

/** Состояние доступа и расход лимитов по выбранной базе (для клиента). */
export const billingMine = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.billingMineSchema.parse(input))
  .handler(async ({ data }) => {
    const { currentUser } = await import("./auth.server");
    const user = await currentUser();
    if (!user) return { data: null, error: { message: "Требуется вход" } };
    try {
      const { accessibleWorkspaces } = await import("./team.server");
      const { workspaceAccess, workspaceUsage } = await import("./billing.server");
      const { emailConfirmed } = await import("./auth.server");
      const confirmed = await emailConfirmed(user.id);
      if (!data.workspaceId) return { data: { access: null, usage: null, emailConfirmed: confirmed }, error: null };
      const scope = await accessibleWorkspaces(user.id);
      if (!scope.includes(data.workspaceId)) {
        return { data: null, error: { message: "Нет доступа к этой базе" } };
      }
      const [access, usage] = await Promise.all([
        workspaceAccess(data.workspaceId),
        workspaceUsage(data.workspaceId),
      ]);
      return { data: { access, usage, emailConfirmed: confirmed }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

/** Список клиентов (баз) с тарифом, сроком и расходом лимитов. */
export const adminBillingList = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./auth.server");
  const { sql } = await import("./pg.server");
  try {
    await requireAdmin();
    const s = sql();
    const rows = await s`
      select w.id,
             coalesce(w.data->>'name', 'База') as name,
             w.plan,
             w.paid_until,
             w.suspended,
             coalesce(w.extra_members, 0) as extra_members,
             coalesce(w.addons, '[]'::jsonb) as addons,
             u.email as owner,
             u.email_confirmed_at,
             (select count(*)::int from products p where p.workspace_id = w.id) as products,
             (select count(*)::int from partners pt where pt.workspace_id = w.id) as partners,
             (select count(*)::int from invoices i where i.workspace_id = w.id) as invoices,
             (select count(*)::int from invoices i
               where i.workspace_id = w.id and i.created_at >= date_trunc('month', now())) as docs_month,
             (select count(*)::int from workspace_members m where m.workspace_id = w.id) as members,
             (select coalesce(sum(octet_length(f.bytes)), 0)::bigint from files f where f.workspace_id = w.id) as bytes,
             (select coalesce(sum(pay.amount), 0)::numeric from workspace_payments pay where pay.workspace_id = w.id) as paid_total
        from workspaces w
        left join app_users u on u.id = w.user_id
       order by w.created_at asc`;
    return {
      data: rows.map((r: any) => ({
        ...r,
        storageMb: Math.round(Number(r.bytes ?? 0) / 1024 / 1024),
        paid_total: Number(r.paid_total ?? 0),
      })),
      error: null,
    };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  }
});

/** История платежей по базе. */
export const adminPayments = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.workspaceIdSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    try {
      await requireAdmin();
      const s = sql();
      const rows = await s`
        select p.*, u.email as author
          from workspace_payments p
          left join app_users u on u.id = p.created_by
         where p.workspace_id = ${data.workspaceId}
         order by p.created_at desc
         limit 200`;
      return { data: rows, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

/** Сменить тариф базы. */
export const adminSetPlan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminSetPlanSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    const { clearBillingCache } = await import("./billing.server");
    try {
      await requireAdmin();
      const s = sql();
      await s`update workspaces set plan = ${data.plan} where id = ${data.workspaceId}`;
      clearBillingCache(data.workspaceId);
      return { data: { ok: true }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

/** Приостановить или вернуть доступ к базе. */
export const adminSuspend = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminSuspendSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    const { clearBillingCache } = await import("./billing.server");
    try {
      await requireAdmin();
      const s = sql();
      await s`update workspaces set suspended = ${data.suspended} where id = ${data.workspaceId}`;
      clearBillingCache(data.workspaceId);
      return { data: { ok: true }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

/** Зарегистрировать оплату и продлить доступ на указанное число месяцев. */
export const adminAddPayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.adminPaymentSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    const { clearBillingCache } = await import("./billing.server");
    try {
      const admin = await requireAdmin();
      const s = sql();
      const cur = await s`select plan, paid_until from workspaces where id = ${data.workspaceId} limit 1`;
      if (!cur.length) throw new Error("База не найдена");
      const plan = data.plan ?? String((cur[0] as any).plan ?? "trial");
      const rows = await s`
        update workspaces
           set plan = ${plan},
               suspended = false,
               paid_until = greatest(coalesce(paid_until, now()), now()) + (${data.months} || ' months')::interval
         where id = ${data.workspaceId}
         returning paid_until`;
      const paidUntil = (rows[0] as any)?.paid_until ?? null;
      await s`
        insert into workspace_payments (workspace_id, amount, months, plan, paid_until, comment, created_by)
        values (${data.workspaceId}, ${data.amount}, ${data.months}, ${plan}, ${paidUntil},
                ${data.comment ?? ""}, ${admin.id})`;
      clearBillingCache(data.workspaceId);
      return { data: { paidUntil }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });
