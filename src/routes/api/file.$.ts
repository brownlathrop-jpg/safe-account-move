import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/file/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = (params as any)._splat as string;
        const { currentUser } = await import("@/lib/auth.server");
        const user = await currentUser().catch(() => null);
        if (!user) return new Response("Требуется вход", { status: 401 });

        const { sql } = await import("@/lib/pg.server");
        const { accessibleWorkspaces } = await import("@/lib/team.server");
        const scope = await accessibleWorkspaces(user.id);
        const s = sql();
        const rows = await s`
          select content_type, bytes, workspace_id from files
          where bucket = 'product-images' and path = ${path} limit 1`;
        if (!rows.length) return new Response("Not found", { status: 404 });
        const row = rows[0] as any;
        // картинка отдаётся только участникам своей базы
        if (!row.workspace_id || !scope.includes(row.workspace_id as string)) {
          return new Response("Нет доступа", { status: 403 });
        }
        return new Response(new Uint8Array(row.bytes as Buffer), {
          headers: {
            "Content-Type": row.content_type ?? "application/octet-stream",
            "Cache-Control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
