// Поток изменений для браузера (Server-Sent Events).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/realtime")({
  server: {
    handlers: {
      GET: async () => {
        const { currentUser } = await import("@/lib/auth.server");
        const user = await currentUser().catch(() => null);
        if (!user) return new Response("Требуется вход", { status: 401 });

        const { subscribeChanges } = await import("@/lib/realtime.server");
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;

        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: string) => {
              try {
                controller.enqueue(encoder.encode(data));
              } catch {
                /* поток закрыт */
              }
            };
            send(": подключено\n\n");
            unsubscribe = await subscribeChanges((event) => {
              send(`data: ${JSON.stringify(event)}\n\n`);
            });
            ping = setInterval(() => send(": ping\n\n"), 25000);
          },
          cancel() {
            unsubscribe?.();
            if (ping) clearInterval(ping);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
