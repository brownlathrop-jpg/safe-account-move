// Ручная выгрузка всех данных базы одним файлом (JSON).
import { sql } from "./pg.server";

/** Таблицы, которые входят в полную выгрузку данных базы. */
const TABLES = [
  "workspaces",
  "products",
  "product_folders",
  "product_types",
  "partners",
  "invoices",
  "invoice_items",
  "invoice_payments",
  "invoice_statuses",
  "warehouses",
  "stock_movements",
  "stock_receipts",
  "stock_receipt_items",
  "cashflow_items",
  "organizations",
  "bank_accounts",
  "banks",
  "price_types",
  "units",
] as const;

export type BackupDump = {
  exported_at: string;
  workspace_id: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
};

export async function exportWorkspace(workspaceId: string): Promise<BackupDump> {
  const s = sql();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows =
      t === "workspaces"
        ? await s`select id, workspace_id, user_id, data, created_at, updated_at from workspaces where id = ${workspaceId}`
        : await s.unsafe(
            `select id, workspace_id, user_id, data, created_at, updated_at from ${t} where workspace_id = $1`,
            [workspaceId],
          );
    tables[t] = rows as unknown[];
    counts[t] = (rows as unknown[]).length;
  }
  return { exported_at: new Date().toISOString(), workspace_id: workspaceId, tables, counts };
}
