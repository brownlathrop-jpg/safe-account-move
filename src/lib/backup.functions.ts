// Серверная функция ручной выгрузки всех данных базы.
import { createServerFn } from "@tanstack/react-start";

export const backupExport = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { requireUser } = await import("./auth.server");
      const team = await import("./team.server");
      const backup = await import("./backup.server");
      const user = await requireUser();
      const role = await team.roleIn(user.id, data.workspaceId);
      if (role !== "owner") throw new Error("Выгрузку всех данных делает владелец базы");
      return { data: await backup.exportWorkspace(data.workspaceId), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });
