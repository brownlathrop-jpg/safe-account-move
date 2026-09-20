// Серверные функции сохранения документа одной транзакцией.
import { createServerFn } from "@tanstack/react-start";
import * as V from "./validate";

type SaveItem = Record<string, unknown>;

export const invoiceSaveTx = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.invoiceSaveSchema.parse(input) as { invoiceId: string; header: Record<string, unknown>; items: SaveItem[] })
  .handler(async ({ data }) => {
    try {
      const { requireUser } = await import("./auth.server");
      const save = await import("./invoice-save.server");
      const user = await requireUser();
      const res = await save.saveInvoice({
        userId: user.id,
        userEmail: user.email,
        invoiceId: data.invoiceId,
        header: data.header,
        items: data.items as any,
      });
      return { data: { id: res.id }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const invoiceCreateTx = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => V.invoiceCreateSchema.parse(input) as { workspaceId: string; header: Record<string, unknown>; items: SaveItem[] })
  .handler(async ({ data }) => {
    try {
      const { requireUser } = await import("./auth.server");
      const save = await import("./invoice-save.server");
      const user = await requireUser();
      const res = await save.createInvoice({
        userId: user.id,
        userEmail: user.email,
        workspaceId: data.workspaceId,
        header: data.header,
        items: data.items as any,
      });
      return { data: { id: res.id }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });
