// Активная "база данных" (workspace) пользователя.
// Хранится в localStorage, чтобы переживать перезагрузки, и в памяти,
// чтобы синхронно отдаваться в React через useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { db } from "@/integrations/firebase/db";

export type Workspace = { id: string; user_id: string; name: string; created_at: string };

const KEY = "active-workspace-id";

function initial(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let activeId: string | null = initial();
const listeners = new Set<() => void>();

export const activeWorkspace = {
  get: () => activeId,
  set(id: string | null) {
    if (id === activeId) return;
    activeId = id;
    if (typeof window !== "undefined") {
      try {
        if (id) localStorage.setItem(KEY, id);
        else localStorage.removeItem(KEY);
      } catch {}
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/**
 * Убедиться, что у пользователя есть хотя бы одна база и активная выбрана.
 * Если баз нет — создаёт "Тестовая".
 * Возвращает id активной базы.
 */
export async function ensureWorkspace(userId: string): Promise<string> {
  const { data, error } = await (db as any)
    .from("workspaces")
    .select("id,name,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const list = (data ?? []) as { id: string }[];
  if (list.length === 0) {
    const { data: created, error: e2 } = await (db as any)
      .from("workspaces")
      .insert({ user_id: userId, name: "Тестовая" })
      .select("id")
      .single();
    if (e2) throw e2;
    activeWorkspace.set((created as any).id);
    return (created as any).id;
  }
  const cur = activeWorkspace.get();
  if (cur && list.some((w) => w.id === cur)) return cur;
  activeWorkspace.set(list[0].id);
  return list[0].id;
}

export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(
    (l) => activeWorkspace.subscribe(l),
    () => activeWorkspace.get(),
    () => null,
  );
}