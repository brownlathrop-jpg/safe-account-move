// Сохранение документа одной транзакцией: шапка + позиции + пересчёт суммы.
// Если что-то падает, база остаётся в прежнем состоянии — полусохранённых
// документов не бывает.
import { sql } from "./pg.server";
import { roleIn, canWrite, logChange } from "./team.server";

export type SaveItem = {
  id?: string | null;
  product_id?: string | null;
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
  sum?: number | null;
  kind?: string | null;
  discount_kind?: string | null;
  discount_value?: number | null;
  discount_name?: string | null;
  /** Ставка НДС по строке (null — без НДС) и сумма налога. */
  vat_rate?: number | null;
  vat_sum?: number | null;
};

const TOTAL_SQL = `coalesce((
  select sum(coalesce((data->>'sum')::numeric,
             coalesce((data->>'quantity')::numeric, 0) * coalesce((data->>'price')::numeric, 0)))
    from invoice_items where data->>'invoice_id' = $1), 0)`;

async function checkAccess(userId: string, workspaceId: string | null, addingDocs = 0) {
  const role = await roleIn(userId, workspaceId);
  if (!role) throw new Error("Нет доступа к этой базе");
  if (!canWrite(role, "invoices")) throw new Error("Недостаточно прав для изменения документов");
  if (workspaceId) {
    // приостановленная или неоплаченная база — только чтение, плюс лимит тарифа
    const { assertWriteAllowed, assertInsertLimit } = await import("./billing.server");
    await assertWriteAllowed(workspaceId);
    if (addingDocs > 0) await assertInsertLimit("invoices", workspaceId, addingDocs);
  }
}

/** Обновить существующий документ: шапка и позиции целиком. */
export async function saveInvoice(opts: {
  userId: string;
  userEmail: string;
  invoiceId: string;
  header: Record<string, unknown>;
  items: SaveItem[];
}) {
  const s = sql();
  const found = await s`select id, workspace_id, user_id from invoices where id = ${opts.invoiceId} limit 1`;
  const inv = (found as any[])[0];
  if (!inv) throw new Error("Документ не найден");
  const wsId: string | null = inv.workspace_id ?? null;
  await checkAccess(opts.userId, wsId);

  await s.begin(async (t) => {
    await t.unsafe(
      `update invoices set data = data || $2::jsonb, updated_at = now() where id = $1`,
      // объект передаём как есть: драйвер сам кодирует его в jsonb.
      // JSON.stringify здесь давал бы jsonb-строку (скаляр) вместо объекта.
      [opts.invoiceId, opts.header] as any,
    );

    const keep = opts.items.map((i) => i.id).filter((v): v is string => !!v);
    await t.unsafe(
      `delete from invoice_items
        where data->>'invoice_id' = $1 and not (id = any($2::text[]))`,
      [opts.invoiceId, keep] as any,
    );

    for (const it of opts.items) {
      const id = it.id || crypto.randomUUID();
      const data = { ...it, id, invoice_id: opts.invoiceId };
      await t.unsafe(
        `insert into invoice_items (id, workspace_id, user_id, data)
         values ($1, $2, $3, $4::jsonb)
         on conflict (id) do update set data = invoice_items.data || excluded.data, updated_at = now()`,
        [id, wsId, inv.user_id ?? null, data] as any,
      );
    }

    await t.unsafe(
      `update invoices
          set data = jsonb_set(case when jsonb_typeof(data) = 'object' then data else '{}'::jsonb end, '{total}', to_jsonb(${TOTAL_SQL}), true), updated_at = now()
        where id = $1`,
      [opts.invoiceId] as any,
    );
  });

  void logChange({
    table: "invoices",
    docId: opts.invoiceId,
    workspaceId: wsId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    op: "update",
    changes: opts.header,
  });
  return { id: opts.invoiceId, workspaceId: wsId };
}

/** Создать документ вместе с позициями одной транзакцией. */
export async function createInvoice(opts: {
  userId: string;
  userEmail: string;
  workspaceId: string;
  header: Record<string, unknown>;
  items: SaveItem[];
}) {
  const s = sql();
  await checkAccess(opts.userId, opts.workspaceId, 1);
  const id = crypto.randomUUID();

  await s.begin(async (t) => {
    const data = { ...opts.header, id, workspace_id: opts.workspaceId, user_id: opts.userId };
    await t.unsafe(
      `insert into invoices (id, workspace_id, user_id, data) values ($1, $2, $3, $4::jsonb)`,
      [id, opts.workspaceId, opts.userId, data] as any,
    );
    for (const it of opts.items) {
      const itemId = it.id || crypto.randomUUID();
      await t.unsafe(
        `insert into invoice_items (id, workspace_id, user_id, data) values ($1, $2, $3, $4::jsonb)`,
        [itemId, opts.workspaceId, opts.userId, { ...it, id: itemId, invoice_id: id }] as any,
      );
    }
    await t.unsafe(
      `update invoices set data = jsonb_set(case when jsonb_typeof(data) = 'object' then data else '{}'::jsonb end, '{total}', to_jsonb(${TOTAL_SQL}), true), updated_at = now() where id = $1`,
      [id] as any,
    );
  });

  void logChange({
    table: "invoices",
    docId: id,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    op: "insert",
    changes: opts.header,
  });
  return { id };
}
