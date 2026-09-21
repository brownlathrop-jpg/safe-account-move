// Тариф активной базы: лимиты, что включено, срок оплаты.
import { useQuery } from "@tanstack/react-query";
import { billingMine } from "@/lib/billing.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { type PlanFeatures, type PlanId, type PlanLimits } from "@/lib/plans";

export type BillingAccess = {
  workspaceId: string;
  name: string;
  plan: PlanId;
  planLabel: string;
  paidUntil: string | null;
  suspended: boolean;
  readOnly: boolean;
  daysLeft: number | null;
  reason: string;
  limits: PlanLimits;
  features: PlanFeatures;
  extraMembers: number;
  addons: string[];
  priceMonth: number;
};

export type BillingUsage = {
  products: number;
  partners: number;
  invoices: number;
  docsThisMonth: number;
  members: number;
  storageMb: number;
};

const ALL_ALLOWED: PlanFeatures = {
  kudir: true,
  cashbook: true,
  exchange1c: true,
  team: true,
  analytics: true,
  api: true,
  priority: true,
};

/** Данные о тарифе активной базы. Пока данные не пришли, ничего не скрываем. */
export function useBilling() {
  const workspaceId = useActiveWorkspaceId();
  const q = useQuery({
    queryKey: ["billing-mine", workspaceId],
    staleTime: 60_000,
    queryFn: async () => {
      const res: any = await billingMine({ data: { workspaceId } });
      if (res?.error) return null;
      return res.data as {
        access: BillingAccess | null;
        usage: BillingUsage | null;
        emailConfirmed: boolean;
      } | null;
    },
  });

  const access = q.data?.access ?? null;
  return {
    loading: q.isLoading,
    access,
    usage: q.data?.usage ?? null,
    emailConfirmed: q.data?.emailConfirmed ?? true,
    features: access?.features ?? ALL_ALLOWED,
  };
}

/** Входит ли возможность в тариф активной базы. */
export function useFeature(feature: keyof PlanFeatures) {
  const { features, loading, access } = useBilling();
  return { allowed: features[feature], loading, planLabel: access?.planLabel ?? "" };
}
