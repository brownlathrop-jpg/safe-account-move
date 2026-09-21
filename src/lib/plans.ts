// Тарифы и лимиты. Файл безопасен для браузера (используется и в интерфейсе).

export type PlanId = "trial" | "start" | "pro";

/** null — без ограничения. */
export type PlanLimits = {
  workspaces: number | null;
  members: number | null;
  products: number | null;
  invoices: number | null;
  storageMb: number | null;
};

export type Plan = { label: string; priceMonth: number; limits: PlanLimits };

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    label: "Пробный",
    priceMonth: 0,
    limits: { workspaces: 1, members: 2, products: 500, invoices: 200, storageMb: 200 },
  },
  start: {
    label: "Старт",
    priceMonth: 1500,
    limits: { workspaces: 1, members: 5, products: 5000, invoices: 5000, storageMb: 2000 },
  },
  pro: {
    label: "Профи",
    priceMonth: 3500,
    limits: { workspaces: 5, members: null, products: null, invoices: null, storageMb: 20000 },
  },
};

export const PLAN_IDS: PlanId[] = ["trial", "start", "pro"];

export function planId(value: unknown): PlanId {
  const v = String(value ?? "");
  return (PLAN_IDS as string[]).includes(v) ? (v as PlanId) : "trial";
}

export function planLabel(value: unknown): string {
  return PLANS[planId(value)].label;
}

export function limitsOf(value: unknown): PlanLimits {
  return PLANS[planId(value)].limits;
}

/** Понятная подпись лимита: «120 из 500» либо «120 (без ограничения)». */
export function limitText(used: number, limit: number | null): string {
  return limit === null ? `${used} (без ограничения)` : `${used} из ${limit}`;
}
