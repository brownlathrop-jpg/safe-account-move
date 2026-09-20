// Серверные функции: себестоимость по партиям (FIFO).
import { createServerFn } from "@tanstack/react-start";
import * as V from "./validate";

async function assertAccess(workspaceId: string) {
  const { requireUser } = await import("./auth.server");
  const { roleIn } = await import("./team.server");
  const user = await requireUser();
  const role = await roleIn(user.id, workspaceId);
  if (!role) throw new Error("Нет доступа к этой базе");
  return { user, role };
}

/** Пересчитать себестоимость товаров и расходных документов базы. */
export const costsRecalc = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.workspaceOnlySchema.parse(input))
  .handler(async ({ data }) => {
    try {
      await assertAccess(data.workspaceId);
      const { recalcCosts } = await import("./cost.server");
      return { ...(await recalcCosts(data.workspaceId)), error: null };
    } catch (e: any) {
      return { products: 0, docs: 0, error: { message: e?.message ?? String(e) } };
    }
  });

/** Непогашенные партии одного товара. */
export const costBatches = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.costProductSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      await assertAccess(data.workspaceId);
      const { productCost } = await import("./cost.server");
      const res = await productCost(data.workspaceId, data.productId);
      return { cost: res?.cost ?? 0, qty: res?.qty ?? 0, batches: res?.batches ?? [], error: null };
    } catch (e: any) {
      return { cost: 0, qty: 0, batches: [], error: { message: e?.message ?? String(e) } };
    }
  });

/** Себестоимость и остаток по всем товарам базы (для страницы склада). */
export const costsAll = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.workspaceOnlySchema.parse(input))
  .handler(async ({ data }) => {
    try {
      await assertAccess(data.workspaceId);
      const { computeCosts } = await import("./cost.server");
      const { costs } = await computeCosts(data.workspaceId);
      return {
        rows: [...costs.values()].map((c) => ({
          product_id: c.product_id,
          cost: c.cost,
          qty: c.qty,
          batches: c.batches,
        })),
        error: null,
      };
    } catch (e: any) {
      return { rows: [], error: { message: e?.message ?? String(e) } };
    }
  });
