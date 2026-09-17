// Серверная функция общего поиска.
import { createServerFn } from "@tanstack/react-start";

export const searchAll = createServerFn({ method: "POST" })
  .inputValidator((d: { q: string; workspaceId?: string | null }) => d)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { globalSearch } = await import("./search.server");
    const user = await requireUser();
    return await globalSearch(user.id, data.q, data.workspaceId ?? null);
  });
