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
        const { accessibleWorkspaces } = await import("@/lib/team.server");
        // список своих баз: события чужих клиентов наружу не уходят
        let scope = new Set(await accessibleWorkspaces(user.id));
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;
        let refresh: ReturnType<typeof setInterval> | null = null;

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
              if (!event.workspace_id || !scope.has(event.workspace_id)) return;
              send(`data: ${JSON.stringify(event)}\n\n`);
            });
            ping = setInterval(() => send(": ping\n\n"), 25000);
            // соединение живёт часами: раз в минуту перечитываем список баз,
            // чтобы исключённый сотрудник перестал получать события
            refresh = setInterval(async () => {
              try {
                scope = new Set(await accessibleWorkspaces(user.id));
              } catch {
                /* сбой запроса не должен рвать поток */
              }
            }, 60000);
          },
          cancel() {
            unsubscribe?.();
            if (ping) clearInterval(ping);
            if (refresh) clearInterval(refresh);
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
