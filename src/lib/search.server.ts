// Общий поиск по базе: товары, контрагенты, документы.
import { sql } from "./pg.server";
import { accessibleWorkspaces } from "./team.server";

export type SearchHit = {
  type: "product" | "partner" | "invoice" | "shipment";
  id: string;
  title: string;
  subtitle: string;
};

export async function globalSearch(userId: string, q: string, workspaceId?: string | null): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const all = await accessibleWorkspaces(userId);
  const ids = workspaceId && all.includes(workspaceId) ? [workspaceId] : all;
  if (!ids.length) return [];
  const s = sql();
  const like = `%${term.toLowerCase()}%`;

  const products = await s`
    select id, data->>'name' as name, data->>'sku' as sku, data->>'price' as price
    from products
    where workspace_id = any(${ids})
      and (lower(coalesce(data->>'name','')) like ${like} or lower(coalesce(data->>'sku','')) like ${like})
    order by data->>'name'
    limit 8
  `;
  const partners = await s`
    select id, data->>'name' as name, data->>'inn' as inn, data->>'phone' as phone
    from partners
    where workspace_id = any(${ids})
      and (lower(coalesce(data->>'name','')) like ${like}
        or coalesce(data->>'inn','') like ${like}
        or lower(coalesce(data->>'phone','')) like ${like})
    order by data->>'name'
    limit 8
  `;
  const docs = await s`
    select i.id,
           i.data->>'number' as number,
           i.data->>'doc_type' as doc_type,
           i.data->>'issue_date' as issue_date,
           i.data->>'total' as total,
           p.data->>'name' as partner
    from invoices i
    left join partners p on p.id = i.data->>'partner_id'
    where i.workspace_id = any(${ids})
      and (lower(coalesce(i.data->>'number','')) like ${like}
        or lower(coalesce(p.data->>'name','')) like ${like})
    order by i.data->>'issue_date' desc
    limit 8
  `;

  const money = (v: any) => {
    const n = Number(v || 0);
    return n ? new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n) : "";
  };

  const hits: SearchHit[] = [];
  for (const r of products as any[]) {
    hits.push({
      type: "product",
      id: r.id,
      title: r.name || "Без названия",
      subtitle: [r.sku ? `код ${r.sku}` : "", money(r.price)].filter(Boolean).join(" · "),
    });
  }
  for (const r of partners as any[]) {
    hits.push({
      type: "partner",
      id: r.id,
      title: r.name || "Без названия",
      subtitle: [r.inn ? `ИНН ${r.inn}` : "", r.phone || ""].filter(Boolean).join(" · "),
    });
  }
  for (const r of docs as any[]) {
    hits.push({
      type: r.doc_type === "shipment" ? "shipment" : "invoice",
      id: r.id,
      title: `${r.doc_type === "shipment" ? "Накладная" : "Заявка"} № ${r.number ?? "—"}`,
      subtitle: [r.partner || "", money(r.total), r.issue_date ? String(r.issue_date).slice(0, 10).split("-").reverse().join(".") : ""]
        .filter(Boolean).join(" · "),
    });
  }
  return hits;
}
