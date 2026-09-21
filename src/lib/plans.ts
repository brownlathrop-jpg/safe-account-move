// Тарифы, лимиты и возможности. Файл безопасен для браузера (используется и в интерфейсе).

export type PlanId = "free" | "ip" | "business" | "opt";

/** null — без ограничения. */
export type PlanLimits = {
  workspaces: number | null;
  members: number | null;
  products: number | null;
  partners: number | null;
  invoices: number | null;
  /** Ограничение на число документов в текущем месяце. */
  docsPerMonth: number | null;
  storageMb: number | null;
};

/** Что доступно на тарифе. */
export type PlanFeatures = {
  /** КУДиР */
  kudir: boolean;
  /** Кассовая книга */
  cashbook: boolean;
  /** Импорт и выгрузка 1С */
  exchange1c: boolean;
  /** Командная работа: сотрудники, роли, история изменений */
  team: boolean;
  /** Расширенная аналитика: ABC-анализ, прогноз закупок */
  analytics: boolean;
  /** API для интеграций */
  api: boolean;
  /** Приоритетная поддержка */
  priority: boolean;
};

export type Plan = {
  label: string;
  priceMonth: number;
  /** Подпись про число пользователей: «1», «2–7» и т.д. */
  usersLabel: string;
  summary: string;
  includes: string[];
  excludes: string[];
  limits: PlanLimits;
  features: PlanFeatures;
};

const NO_FEATURES: PlanFeatures = {
  kudir: false,
  cashbook: false,
  exchange1c: false,
  team: false,
  analytics: false,
  api: false,
  priority: false,
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    label: "Бесплатный",
    priceMonth: 0,
    usersLabel: "1",
    summary: "Чтобы попробовать работу в базе без оплаты",
    includes: ["Склад и остатки", "Базовые документы", "Касса"],
    excludes: ["КУДиР", "Кассовая книга", "Импорт и выгрузка 1С", "Командная работа"],
    limits: {
      workspaces: 1,
      members: 1,
      products: 500,
      partners: 200,
      invoices: null,
      docsPerMonth: 200,
      storageMb: 200,
    },
    features: { ...NO_FEATURES },
  },
  ip: {
    label: "ИП",
    priceMonth: 990,
    usersLabel: "1",
    summary: "Для работы одного человека без ограничений по количеству",
    includes: ["Склад и остатки", "Документы", "Касса", "Отчёты"],
    excludes: ["КУДиР", "Кассовая книга"],
    limits: {
      workspaces: 1,
      members: 1,
      products: null,
      partners: null,
      invoices: null,
      docsPerMonth: null,
      storageMb: 10000,
    },
    features: { ...NO_FEATURES },
  },
  business: {
    label: "Бизнес",
    priceMonth: 2490,
    usersLabel: "2–7",
    summary: "Всё из «ИП» плюс учёт и командная работа",
    includes: [
      "Всё из тарифа «ИП»",
      "КУДиР",
      "Кассовая книга",
      "Импорт и выгрузка 1С",
      "Сотрудники, роли и история изменений",
    ],
    excludes: ["Расширенная аналитика", "API для интеграций"],
    limits: {
      workspaces: 2,
      members: 7,
      products: null,
      partners: null,
      invoices: null,
      docsPerMonth: null,
      storageMb: 20000,
    },
    features: {
      kudir: true,
      cashbook: true,
      exchange1c: true,
      team: true,
      analytics: false,
      api: false,
      priority: false,
    },
  },
  opt: {
    label: "Опт",
    priceMonth: 4490,
    usersLabel: "8–20",
    summary: "Для оптовой торговли и большой команды",
    includes: [
      "Всё из тарифа «Бизнес»",
      "Приоритетная поддержка",
      "Расширенная аналитика: ABC-анализ, прогноз закупок",
      "API для интеграций",
    ],
    excludes: [],
    limits: {
      workspaces: 5,
      members: 20,
      products: null,
      partners: null,
      invoices: null,
      docsPerMonth: null,
      storageMb: 50000,
    },
    features: {
      kudir: true,
      cashbook: true,
      exchange1c: true,
      team: true,
      analytics: true,
      api: true,
      priority: true,
    },
  },
};

export const PLAN_IDS: PlanId[] = ["free", "ip", "business", "opt"];

/** Цена дополнительного пользователя сверх лимита тарифа, ₽/мес. */
export const EXTRA_MEMBER_PRICE = 400;

export type AddonId = "marking" | "marketplaces";

export const ADDONS: Record<AddonId, { label: string; priceMonth: number; note: string }> = {
  marking: { label: "Маркировка товаров", priceMonth: 500, note: "Работа с маркированными товарами" },
  marketplaces: {
    label: "Интеграция с маркетплейсами",
    priceMonth: 1000,
    note: "Обмен заказами и остатками с площадками",
  },
};

export const ADDON_IDS: AddonId[] = ["marking", "marketplaces"];

/** Индивидуальные доработки, ₽/час. */
export const CUSTOM_WORK_HOUR = 3000;

/** Старые названия тарифов приводим к новым. */
const LEGACY: Record<string, PlanId> = { trial: "free", start: "ip", pro: "opt" };

export function planId(value: unknown): PlanId {
  const v = String(value ?? "");
  if ((PLAN_IDS as string[]).includes(v)) return v as PlanId;
  return LEGACY[v] ?? "free";
}

export function planLabel(value: unknown): string {
  return PLANS[planId(value)].label;
}

export function limitsOf(value: unknown): PlanLimits {
  return PLANS[planId(value)].limits;
}

export function featuresOf(value: unknown): PlanFeatures {
  return PLANS[planId(value)].features;
}

/** Лимит сотрудников с учётом докупленных пользователей. */
export function membersLimit(value: unknown, extraMembers = 0): number | null {
  const base = PLANS[planId(value)].limits.members;
  return base === null ? null : base + Math.max(0, extraMembers);
}

export function addonId(value: unknown): AddonId | null {
  const v = String(value ?? "");
  return (ADDON_IDS as string[]).includes(v) ? (v as AddonId) : null;
}

/** Стоимость в месяц: тариф + дополнительные пользователи + опции. */
export function monthlyPrice(value: unknown, extraMembers = 0, addons: string[] = []): number {
  let sum = PLANS[planId(value)].priceMonth;
  sum += Math.max(0, extraMembers) * EXTRA_MEMBER_PRICE;
  for (const a of addons) {
    const id = addonId(a);
    if (id) sum += ADDONS[id].priceMonth;
  }
  return sum;
}

/** Понятная подпись лимита: «120 из 500» либо «120 (без ограничения)». */
export function limitText(used: number, limit: number | null): string {
  return limit === null ? `${used} (без ограничения)` : `${used} из ${limit}`;
}

export const FEATURE_LABEL: Record<keyof PlanFeatures, string> = {
  kudir: "КУДиР",
  cashbook: "Кассовая книга",
  exchange1c: "Импорт и выгрузка 1С",
  team: "Командная работа",
  analytics: "Расширенная аналитика",
  api: "API для интеграций",
  priority: "Приоритетная поддержка",
};
