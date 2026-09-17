import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/file/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = (params as any)._splat as string;
        const { sql } = await import("@/lib/pg.server");
        const s = sql();
        const rows = await s`
          select content_type, bytes from files
          where bucket = 'product-images' and path = ${path} limit 1`;
        if (!rows.length) return new Response("Not found", { status: 404 });
        const row = rows[0] as any;
        return new Response(new Uint8Array(row.bytes as Buffer), {
          headers: {
            "Content-Type": row.content_type ?? "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
