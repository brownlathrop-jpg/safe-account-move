// Типы цен: справочник в базе + личный выбор пользователя «по умолчанию».
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { userPrefsGet, userPrefsSet } from "@/lib/db.functions";

export type PriceType = { id: string; name: string; currency: string; is_default: boolean };

/** Товар с набором цен по типам. */
export type PricedProduct = { price?: number; cost?: number; prices?: Record<string, number> | null };

/** Цена товара для выбранного типа цены (с откатом на основную цену). */
export function priceOf(p: PricedProduct, priceTypeId?: string | null): number {
  const map = p.prices ?? null;
  if (priceTypeId && map && map[priceTypeId] != null && map[priceTypeId] !== ("" as never)) {
    return Number(map[priceTypeId]) || 0;
  }
  return Number(p.price ?? 0) || 0;
}

export function usePriceTypes(wsId: string | null | undefined) {
  return useQuery({
    queryKey: ["price_types", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await (db as any).from("price_types")
        .select("id,name,currency,is_default").eq("workspace_id", wsId)
        .order("is_default", { ascending: false }).order("name");
      return (data ?? []) as PriceType[];
    },
  });
}

export function useUserPrefs() {
  return useQuery({
    queryKey: ["user_prefs"],
    queryFn: async () => (await userPrefsGet()).prefs ?? {},
  });
}

/** Тип цены, который подставляется этому пользователю в документах. */
export function useMyPriceTypeId(wsId: string | null | undefined) {
  const { data: types = [] } = usePriceTypes(wsId);
  const { data: prefs } = useUserPrefs();
  const mine = wsId ? (prefs as any)?.default_price_type?.[wsId] : null;
  if (mine && types.some(t => t.id === mine)) return mine as string;
  const def = types.find(t => t.is_default) ?? types[0];
  return def?.id ?? null;
}

export function useSetMyPriceType(wsId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (priceTypeId: string | null) => {
      if (!wsId) throw new Error("Не выбрана база данных");
      const prefs = (await userPrefsGet()).prefs ?? {};
      const map = { ...((prefs as any).default_price_type ?? {}) };
      if (priceTypeId) map[wsId] = priceTypeId; else delete map[wsId];
      await userPrefsSet({ data: { patch: { default_price_type: map } } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_prefs"] }),
  });
}
