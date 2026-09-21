// Тарифы, срок оплаты доступа, лимиты и возможности по базам. Только сервер.
import { sql } from "./pg.server";
import {
  ADDON_IDS,
  FEATURE_LABEL,
  PLANS,
  addonId,
  featuresOf,
  limitsOf,
  membersLimit,
  monthlyPrice,
  planId,
  type PlanFeatures,
  type PlanId,
  type PlanLimits,
} from "./plans";

export type Access = {
  workspaceId: string;
  name: string;
  plan: PlanId;
  planLabel: string;
  paidUntil: string | null;
  suspended: boolean;
  readOnly: boolean;
  /** Сколько дней осталось (может быть отрицательным). null — срок не задан. */
  daysLeft: number | null;
  reason: string;
  limits: PlanLimits;
  features: PlanFeatures;
  extraMembers: number;
  addons: string[];
  priceMonth: number;
};

type WsRow = {
  id: string;
  name: string | null;
  plan: string | null;
  paid_until: Date | string | null;
  suspended: boolean | null;
  user_id: string | null;
  extra_members: number | null;
  addons: unknown;
} | null;

const cache = new Map<string, { at: number; row: WsRow }>();
const TTL = 15_000;

export function clearBillingCache(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

async function wsRow(workspaceId: string): Promise<WsRow> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL) return hit.row;
  const s = sql();
  const rows = await s`
    select id, data->>'name' as name, plan, paid_until, suspended, user_id,
           coalesce(extra_members, 0) as extra_members, coalesce(addons, '[]'::jsonb) as addons
      from workspaces where id = ${workspaceId} limit 1`;
  const row = (rows.length ? (rows[0] as any) : null) as WsRow;
  cache.set(workspaceId, { at: Date.now(), row });
  return row;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAddons(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const p = JSON.parse(value);
            return Array.isArray(p) ? p : [];
          } catch {
            return [];
          }
        })()
      : [];
  const out: string[] = [];
  for (const v of raw) {
    const id = addonId(v);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function buildAccess(row: NonNullable<WsRow>): Access {
  const plan = planId(row.plan);
  const paidUntil = toIso(row.paid_until);
  const suspended = !!row.suspended;
  const extraMembers = Math.max(0, Number(row.extra_members ?? 0) || 0);
  const addons = parseAddons(row.addons);
  const free = PLANS[plan].priceMonth === 0;
  const daysLeft =
    free || paidUntil === null
      ? null
      : Math.ceil((new Date(paidUntil).getTime() - Date.now()) / 86_400_000);
  const expired = daysLeft !== null && daysLeft < 0;
  const readOnly = suspended || expired;
  const reason = suspended
    ? "Доступ к базе приостановлен. Обратитесь в поддержку КабинетCRM."
    : expired
      ? "Срок оплаты закончился: база доступна только для чтения. Продлите доступ."
      : "";
  const limits = { ...limitsOf(plan), members: membersLimit(plan, extraMembers) };
  return {
    workspaceId: String(row.id),
    name: row.name ?? "База",
    plan,
    planLabel: PLANS[plan].label,
    paidUntil,
    suspended,
    readOnly,
    daysLeft,
    reason,
    limits,
    features: featuresOf(plan),
    extraMembers,
    addons,
    priceMonth: monthlyPrice(plan, extraMembers, addons),
  };
}

export async function workspaceAccess(workspaceId: string): Promise<Access | null> {
  const row = await wsRow(workspaceId);
  return row ? buildAccess(row) : null;
}

/** Бросает ошибку, если база приостановлена или срок оплаты закончился. */
export async function assertWriteAllowed(workspaceId: string) {
  const access = await workspaceAccess(workspaceId);
  if (access?.readOnly) throw new Error(access.reason);
}

/** Бросает ошибку, если возможность не входит в тариф базы. */
export async function assertFeature(workspaceId: string, feature: keyof PlanFeatures) {
  const access = await workspaceAccess(workspaceId);
  if (!access) return;
  if (!access.features[feature]) {
    throw new Error(
      `«${FEATURE_LABEL[feature]}» не входит в тариф «${access.planLabel}». Смените тариф, чтобы включить.`,
    );
  }
}

export type Usage = {
  products: number;
  partners: number;
  invoices: number;
  docsThisMonth: number;
  members: number;
  storageMb: number;
};

export async function workspaceUsage(workspaceId: string): Promise<Usage> {
  const s = sql();
  const one = async (q: Promise<any[]>) => Number((await q)[0]?.n ?? 0);
  const [products, partners, invoices, docsThisMonth, members, bytes] = await Promise.all([
    one(s`select count(*)::int as n from products where workspace_id = ${workspaceId}` as any),
    one(s`select count(*)::int as n from partners where workspace_id = ${workspaceId}` as any),
    one(s`select count(*)::int as n from invoices where workspace_id = ${workspaceId}` as any),
    one(s`select count(*)::int as n from invoices
            where workspace_id = ${workspaceId}
              and created_at >= date_trunc('month', now())` as any),
    one(s`select count(*)::int as n from workspace_members where workspace_id = ${workspaceId}` as any),
    one(s`select coalesce(sum(octet_length(bytes)), 0)::bigint as n from files where workspace_id = ${workspaceId}` as any),
  ]);
  return {
    products,
    partners,
    invoices,
    docsThisMonth,
    members,
    storageMb: Math.round(bytes / 1024 / 1024),
  };
}

/** Какой лимит отвечает за таблицу. */
function limitKey(table: string): keyof PlanLimits | null {
  if (table === "products") return "products";
  if (table === "partners") return "partners";
  if (table === "invoices") return "invoices";
  if (table === "workspace_members" || table === "workspace_invites") return "members";
  return null;
}

const LIMIT_LABEL: Record<string, string> = {
  products: "товаров",
  partners: "контрагентов",
  invoices: "документов",
  docsPerMonth: "документов в месяц",
  members: "пользователей",
  workspaces: "баз",
  storageMb: "места (МБ)",
};

/** Проверить лимит тарифа перед добавлением строк. */
export async function assertInsertLimit(table: string, workspaceId: string, adding: number) {
  const key = limitKey(table);
  if (!key || adding <= 0) return;
  const access = await workspaceAccess(workspaceId);
  if (!access) return;
  const s = sql();
  const limit = access.limits[key];
  if (limit !== null) {
    const rows = await s.unsafe(
      `select count(*)::int as n from ${table} where workspace_id = $1`,
      [workspaceId] as any,
    );
    const used = Number((rows[0] as any)?.n ?? 0);
    if (used + adding > limit) {
      throw new Error(
        `Тариф «${access.planLabel}» допускает не более ${limit} ${LIMIT_LABEL[key]}. Сейчас: ${used}. Смените тариф.`,
      );
    }
  }
  // отдельный лимит на документы в текущем месяце
  if (table === "invoices" && access.limits.docsPerMonth !== null) {
    const monthLimit = access.limits.docsPerMonth;
    const rows = await s`
      select count(*)::int as n from invoices
       where workspace_id = ${workspaceId} and created_at >= date_trunc('month', now())`;
    const used = Number((rows[0] as any)?.n ?? 0);
    if (used + adding > monthLimit) {
      throw new Error(
        `Тариф «${access.planLabel}» допускает не более ${monthLimit} документов в месяц. Уже создано: ${used}. Смените тариф.`,
      );
    }
  }
}

/** Проверить место под картинки (МБ) перед загрузкой файла. */
export async function assertStorageLimit(workspaceId: string, addBytes: number) {
  const access = await workspaceAccess(workspaceId);
  const limit = access?.limits.storageMb ?? null;
  if (!access || limit === null) return;
  const s = sql();
  const rows = await s`
    select coalesce(sum(octet_length(bytes)), 0)::bigint as n from files where workspace_id = ${workspaceId}`;
  const usedMb = (Number((rows[0] as any)?.n ?? 0) + addBytes) / 1024 / 1024;
  if (usedMb > limit) {
    throw new Error(`Тариф «${access.planLabel}» допускает не более ${limit} МБ картинок. Смените тариф.`);
  }
}

/**
 * Можно ли создать ещё одну базу: почта подтверждена и лимит тарифа не исчерпан.
 * Тариф берём лучший из уже имеющихся баз, для нового клиента — бесплатный.
 */
export async function assertCanCreateWorkspace(userId: string) {
  const s = sql();
  const users = await s`select email_confirmed_at from app_users where id = ${userId} limit 1`;
  if (users.length && !(users[0] as any).email_confirmed_at) {
    throw new Error("Подтвердите адрес почты по ссылке из письма — потом можно создать базу.");
  }
  const rows = await s`select plan from workspaces where user_id = ${userId}`;
  const count = rows.length;
  if (!count) return;
  const order: PlanId[] = ["free", "ip", "business", "opt"];
  let best: PlanId = "free";
  for (const r of rows) {
    const p = planId((r as any).plan);
    if (order.indexOf(p) > order.indexOf(best)) best = p;
  }
  const limit = PLANS[best].limits.workspaces;
  if (limit !== null && count + 1 > limit) {
    throw new Error(`Тариф «${PLANS[best].label}» допускает не более ${limit} ${LIMIT_LABEL["workspaces"]}.`);
  }
}

/** Разрешённые названия опций (для админки). */
export const ADDON_WHITELIST = ADDON_IDS as readonly string[];
