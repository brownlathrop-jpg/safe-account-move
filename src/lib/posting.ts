/**
 * Проведение накладной по складу.
 * Раньше это делали триггеры в SQL; в Firebase логика живёт в приложении.
 *
 * Продажа (outgoing) списывает товар, закупка (incoming) приходует.
 * Услуги и позиции без товара склад не двигают.
 */
import { db } from "@/integrations/db";
import { warehouseBalanceMap } from "@/lib/stock";

export async function applyShipmentStock(invoiceId: string): Promise<void> {
  const inv = await db.getById("invoices", invoiceId);
  if (!inv) return;

  // Старые движения этого документа всегда убираем.
  const { error: delErr } = await db
    .from("stock_movements")
    .delete()
    .eq("doc_type", "shipment")
    .eq("doc_id", invoiceId);
  if (delErr) throw new Error(delErr.message);

  const { data: items } = await db
    .from("invoice_items")
    .select("id,product_id,name,quantity,price,kind")
    .eq("invoice_id", invoiceId);
  const rows = (items ?? []) as any[];

  // Себестоимость документа считаем всегда.
  const productIds = Array.from(new Set(rows.map((r) => r.product_id).filter(Boolean)));
  const costById = new Map<string, number>();
  const serviceById = new Map<string, boolean>();
  for (const pid of productIds) {
    const p = await db.getById("products", pid);
    if (p) {
      costById.set(pid, Number(p.cost ?? 0));
      serviceById.set(pid, Boolean(p.is_service) || p.kind === "service");
    }
  }
  const costTotal = rows.reduce(
    (acc, r) => acc + Number(r.quantity ?? 0) * (costById.get(r.product_id) ?? 0),
    0,
  );

  const posted = inv.doc_type === "shipment" && inv.status === "posted";
  if (!posted) {
    await db.from("invoices").update({ posted_at: null, cost_total: costTotal }).eq("id", invoiceId);
    return;
  }

  if (!inv.warehouse_id) throw new Error("Нельзя провести накладную без склада");

  const sign = inv.kind === "outgoing" ? -1 : 1;

  // Продажа: проверяем, хватает ли товара на складе (можно разрешить минус в настройках базы).
  if (sign === -1 && inv.workspace_id) {
    const ws = await db.getById("workspaces", inv.workspace_id);
    if (!ws?.allow_negative_stock) {
      const balances = await warehouseBalanceMap(inv.workspace_id, inv.warehouse_id);
      const need = new Map<string, number>();
      for (const r of rows) {
        if (!r.product_id || r.kind === "service" || serviceById.get(r.product_id)) continue;
        need.set(r.product_id, (need.get(r.product_id) ?? 0) + Number(r.quantity ?? 0));
      }
      const short: string[] = [];
      for (const [pid, qty] of need) {
        const have = balances.get(pid) ?? 0;
        if (qty > have) {
          const p = await db.getById("products", pid);
          short.push(`${p?.name ?? "товар"}: нужно ${qty}, на складе ${have}`);
        }
      }
      if (short.length) {
        await db.from("invoices").update({ status: "draft", posted_at: null, cost_total: costTotal }).eq("id", invoiceId);
        throw new Error(`Не хватает товара на складе — ${short.join("; ")}`);
      }
    }
  }
  const movements = rows
    .filter(
      (r) =>
        r.product_id &&
        Number(r.quantity ?? 0) !== 0 &&
        r.kind !== "service" &&
        !serviceById.get(r.product_id),
    )
    .map((r) => ({
      user_id: inv.user_id ?? null,
      workspace_id: inv.workspace_id ?? null,
      warehouse_id: inv.warehouse_id,
      product_id: r.product_id,
      qty: sign * Number(r.quantity ?? 0),
      doc_type: "shipment",
      doc_id: invoiceId,
      moved_at: inv.issue_date ?? new Date().toISOString().slice(0, 10),
    }));

  if (movements.length) {
    const { error } = await db.from("stock_movements").insert(movements);
    if (error) throw new Error(error.message);
  }

  await db
    .from("invoices")
    .update({ posted_at: inv.posted_at ?? new Date().toISOString(), cost_total: costTotal })
    .eq("id", invoiceId);
}

