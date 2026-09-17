/**
 * Остатки склада.
 * Раньше остатки считала база (представление stock_balances), теперь считаем в приложении
 * по движениям склада (stock_movements).
 */
import { db } from "@/integrations/firebase/db";

export type Balance = { warehouse_id: string; product_id: string; qty: number };

type Movement = { warehouse_id: string; product_id: string; qty: number };

export async function fetchMovements(wsId: string): Promise<Movement[]> {
  const { data, error } = await (db as any)
    .from("stock_movements")
    .select("warehouse_id,product_id,qty")
    .eq("workspace_id", wsId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Movement[];
}

export function sumBalances(movements: Movement[]): Balance[] {
  const map = new Map<string, Balance>();
  for (const m of movements) {
    if (!m.product_id || !m.warehouse_id) continue;
    const key = `${m.warehouse_id}|${m.product_id}`;
    const cur = map.get(key);
    if (cur) cur.qty += Number(m.qty ?? 0);
    else map.set(key, { warehouse_id: m.warehouse_id, product_id: m.product_id, qty: Number(m.qty ?? 0) });
  }
  return [...map.values()];
}

export async function fetchBalances(wsId: string): Promise<Balance[]> {
  return sumBalances(await fetchMovements(wsId));
}

/** Остатки конкретного склада: product_id → количество. */
export async function warehouseBalanceMap(
  wsId: string,
  warehouseId: string,
): Promise<Map<string, number>> {
  const rows = await fetchBalances(wsId);
  const map = new Map<string, number>();
  for (const b of rows) {
    if (b.warehouse_id !== warehouseId) continue;
    map.set(b.product_id, (map.get(b.product_id) ?? 0) + b.qty);
  }
  return map;
}
