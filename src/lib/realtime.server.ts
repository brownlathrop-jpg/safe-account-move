// Слушает изменения в PostgreSQL (LISTEN crm_changes) и раздаёт их подписчикам.
import postgres from "postgres";

export type ChangeEvent = {
  table: string;
  id: string | null;
  workspace_id: string | null;
  op: "insert" | "update" | "delete";
};

type Subscriber = (event: ChangeEvent) => void;

const subscribers = new Set<Subscriber>();
let listening: Promise<void> | null = null;
let listenerSql: ReturnType<typeof postgres> | null = null;

function startListening() {
  if (listening) return listening;
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL не задан");
  listenerSql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: { rejectUnauthorized: false },
    onnotice: () => {},
  });
  listening = listenerSql
    .listen("crm_changes", (payload) => {
      let event: ChangeEvent;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      for (const cb of subscribers) {
        try {
          cb(event);
        } catch {
          /* подписчик отвалился — игнорируем */
        }
      }
    })
    .then(() => undefined)
    .catch((e) => {
      console.error("[realtime] не удалось подписаться:", e);
      listening = null;
      listenerSql?.end({ timeout: 1 }).catch(() => {});
      listenerSql = null;
      throw e;
    });
  return listening;
}

export async function subscribeChanges(cb: Subscriber): Promise<() => void> {
  await startListening();
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
