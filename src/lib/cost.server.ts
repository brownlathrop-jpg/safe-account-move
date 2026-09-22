/**
 * Себестоимость по партиям (FIFO).
 *
 * Партия — это приход товара с ценой: поступление на склад (stock_receipts)
 * или закупочная накладная (incoming). Расход (продажа, списание) гасит
 * партии по очереди: сначала самые старые.
 *
 * Текущая себестоимость товара = средневзвешенная цена непогашенных партий.
 * Если партий не осталось — берём цену последнего прихода.
 */
import { sql } from "./pg.server";

export type Batch = {
  qty: number;
  unit: number;
  date: string;
  doc_type: string;
  doc_id: string | null;
};

export type ProductCost = {
  product_id: string;
  cost: number;
  qty: number;
  batches: Batch[];
};

type Move = {
  pid: string;
  qty: number;
  doc_type: string;
  doc_id: string | null;
  at: string;
};

/** Все расчёты по одной базе: себестоимость товаров и себестоимость расходных документов. */
export async function computeCosts(wsId: string): Promise<{
  costs: Map<string, ProductCost>;
  docCost: Map<string, number>;
}> {
  const s = sql();

  const moves = (await s`
    select
      data->>'product_id'                  as pid,
      coalesce((data->>'qty')::numeric, 0)  as qty,
      coalesce(data->>'doc_type', '')       as doc_type,
      data->>'doc_id'                       as doc_id,
      coalesce(data->>'moved_at', created_at::date::text) as at,
      created_at
    from stock_movements
    where workspace_id = ${wsId}
    order by coalesce(data->>'moved_at', created_at::date::text), created_at
  `) as unknown as (Move & { created_at: string })[];

  const receiptPrice = new Map<string, number>();
  const rp = (await s`
    select ri.data->>'receipt_id' as did, ri.data->>'product_id' as pid,
           coalesce((ri.data->>'price')::numeric, 0) as price
    from stock_receipt_items ri
    join stock_receipts r on r.id = ri.data->>'receipt_id'
    where r.workspace_id = ${wsId}
  `) as unknown as { did: string; pid: string; price: number }[];
  for (const r of rp) receiptPrice.set(`${r.did}|${r.pid}`, Number(r.price ?? 0));

  const invoicePrice = new Map<string, number>();
  const ip = (await s`
    select ii.data->>'invoice_id' as did, ii.data->>'product_id' as pid,
           coalesce((ii.data->>'price')::numeric, 0) as price
    from invoice_items ii
    join invoices i on i.id = ii.data->>'invoice_id'
    where i.workspace_id = ${wsId}
  `) as unknown as { did: string; pid: string; price: number }[];
  for (const r of ip) invoicePrice.set(`${r.did}|${r.pid}`, Number(r.price ?? 0));

  // Себестоимость из карточки — запасной вариант для приходов без цены
  // (например, начальные остатки и данные, перенесённые из 1С).
  const fallback = new Map<string, number>();
  const fb = (await s`
    select id, coalesce((data->>'cost')::numeric, 0) as cost
    from products where workspace_id = ${wsId}
  `) as unknown as { id: string; cost: number }[];
  for (const r of fb) fallback.set(r.id, Number(r.cost ?? 0));

  // Возвраты: их приход на склад считается по себестоимости, а не по цене строки.
  const returnDocs = new Set<string>();
  const rd = (await s`
    select id from invoices
    where workspace_id = ${wsId} and coalesce((data->>'is_return')::boolean, false)
  `) as unknown as { id: string }[];
  for (const r of rd) returnDocs.add(r.id);

  const batches = new Map<string, Batch[]>();
  const lastIn = new Map<string, number>();
  const docCost = new Map<string, number>();

  /** Средняя цена непогашенных партий товара (для возвратов). */
  const avgOpen = (pid: string): number => {
    const list = (batches.get(pid) ?? []).filter((b) => b.qty > 1e-9);
    const q = list.reduce((a, b) => a + b.qty, 0);
    if (q > 1e-9) return list.reduce((a, b) => a + b.qty * b.unit, 0) / q;
    return lastIn.get(pid) ?? fallback.get(pid) ?? 0;
  };

  const unitCostOf = (m: Move): number => {
    const key = `${m.doc_id}|${m.pid}`;
    if (m.doc_type === "receipt") {
      const v = receiptPrice.get(key);
      if (v !== undefined && v > 0) return v;
    }
    if (m.doc_type === "shipment") {
      // Возврат от покупателя приходит по себестоимости, а не по цене продажи.
      if (m.doc_id && returnDocs.has(m.doc_id)) return avgOpen(m.pid);
      const v = invoicePrice.get(key);
      if (v !== undefined && v > 0) return v;
    }
    return fallback.get(m.pid) ?? 0;
  };

  for (const m of moves) {
    if (!m.pid) continue;
    const qty = Number(m.qty ?? 0);
    if (!qty) continue;

    if (qty > 0) {
      const unit = unitCostOf(m);
      const list = batches.get(m.pid) ?? [];
      list.push({ qty, unit, date: m.at, doc_type: m.doc_type, doc_id: m.doc_id ?? null });
      batches.set(m.pid, list);
      // Возврат не задаёт новую «последнюю цену прихода».
      if (!(m.doc_id && returnDocs.has(m.doc_id))) lastIn.set(m.pid, unit);
      continue;
    }

    // расход: гасим партии по очереди
    let need = -qty;
    let spent = 0;
    const list = batches.get(m.pid) ?? [];
    while (need > 0 && list.length) {
      const b = list[0]!;
      const take = Math.min(b.qty, need);
      spent += take * b.unit;
      b.qty -= take;
      need -= take;
      if (b.qty <= 1e-9) list.shift();
    }
    if (need > 0) {
      // партий не хватило — считаем по последней известной цене
      spent += need * (lastIn.get(m.pid) ?? fallback.get(m.pid) ?? 0);
    }
    batches.set(m.pid, list);
    if (m.doc_id) docCost.set(m.doc_id, (docCost.get(m.doc_id) ?? 0) + spent);
  }

  const costs = new Map<string, ProductCost>();
  const pids = new Set<string>([...batches.keys(), ...lastIn.keys(), ...fallback.keys()]);
  for (const pid of pids) {
    const list = (batches.get(pid) ?? []).filter((b) => b.qty > 1e-9);
    const qty = list.reduce((a, b) => a + b.qty, 0);
    const sum = list.reduce((a, b) => a + b.qty * b.unit, 0);
    const cost = qty > 1e-9 ? sum / qty : (lastIn.get(pid) ?? fallback.get(pid) ?? 0);
    costs.set(pid, { product_id: pid, cost: round2(cost), qty, batches: list });
  }

  return { costs, docCost };
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** Себестоимость одного товара (для карточки товара). */
export async function productCost(wsId: string, productId: string): Promise<ProductCost | null> {
  const { costs } = await computeCosts(wsId);
  return costs.get(productId) ?? null;
}

/** Пересчитать и записать себестоимость товаров и расходных документов базы. */
export async function recalcCosts(wsId: string): Promise<{ products: number; docs: number }> {
  const s = sql();
  const { costs, docCost } = await computeCosts(wsId);

  let products = 0;
  const current = (await s`
    select id, coalesce((data->>'cost')::numeric, 0) as cost
    from products where workspace_id = ${wsId}
  `) as unknown as { id: string; cost: number }[];
  const curMap = new Map(current.map((r) => [r.id, Number(r.cost ?? 0)]));

  for (const [pid, c] of costs) {
    if (!curMap.has(pid)) continue;
    if (Math.abs((curMap.get(pid) ?? 0) - c.cost) < 0.005) continue;
    await s`
      update products
      set data = jsonb_set(case when jsonb_typeof(data) = 'object' then data else '{}'::jsonb end, '{cost}', to_jsonb(${c.cost}::numeric)), updated_at = now()
      where id = ${pid}
    `;
    products++;
  }

  let docs = 0;
  const invoices = (await s`
    select id, coalesce((data->>'cost_total')::numeric, 0) as cost_total
    from invoices where workspace_id = ${wsId}
  `) as unknown as { id: string; cost_total: number }[];
  for (const inv of invoices) {
    const want = round2(docCost.get(inv.id) ?? 0);
    if (Math.abs(Number(inv.cost_total ?? 0) - want) < 0.005) continue;
    await s`
      update invoices
      set data = jsonb_set(case when jsonb_typeof(data) = 'object' then data else '{}'::jsonb end, '{cost_total}', to_jsonb(${want}::numeric)), updated_at = now()
      where id = ${inv.id}
    `;
    docs++;
  }

  return { products, docs };
}
