// Скидки: справочник скидок и расчёт скидки по строке документа.
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";

export type DiscountKind = "percent" | "amount";

export type Discount = {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number;
};

/** Справочник скидок выбранной базы. */
export function useDiscounts(wsId: string | null | undefined) {
  return useQuery({
    queryKey: ["discounts", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("discounts")
        .select("id,name,kind,value")
        .eq("workspace_id", wsId)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((d: any) => ({
        id: d.id,
        name: d.name,
        kind: (d.kind === "amount" ? "amount" : "percent") as DiscountKind,
        value: Number(d.value) || 0,
      })) as Discount[];
    },
  });
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Сумма строки до скидки. */
export function grossSum(quantity: number, price: number) {
  return round2((Number(quantity) || 0) * (Number(price) || 0));
}

/**
 * Сумма скидки по строке. Проценты считаются от суммы строки,
 * скидка суммой берётся как есть, но не больше суммы строки.
 */
export function discountSum(
  quantity: number,
  price: number,
  kind: DiscountKind | null | undefined,
  value: number | null | undefined,
) {
  const gross = grossSum(quantity, price);
  const v = Number(value) || 0;
  if (!v || gross <= 0) return 0;
  const d = kind === "amount" ? v : (gross * v) / 100;
  return round2(Math.min(Math.max(d, 0), gross));
}

/** Сумма строки со скидкой. */
export function netSum(
  quantity: number,
  price: number,
  kind: DiscountKind | null | undefined,
  value: number | null | undefined,
) {
  return round2(grossSum(quantity, price) - discountSum(quantity, price, kind, value));
}

/** Короткая подпись скидки: «10 %» или «500 ₽». */
export function discountLabel(kind: DiscountKind | null | undefined, value: number | null | undefined) {
  const v = Number(value) || 0;
  if (!v) return "";
  return kind === "amount" ? `${v} ₽` : `${v} %`;
}
