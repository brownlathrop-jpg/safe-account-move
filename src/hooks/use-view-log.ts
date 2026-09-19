import { useEffect, useRef } from "react";
import { teamLogView } from "@/lib/team.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";

/**
 * Записывает в журнал, что сотрудник открыл важный раздел.
 * Одна запись на открытие раздела (без повторов при перерисовках).
 */
export function useViewLog(section: string) {
  const wsId = useActiveWorkspaceId();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const key = `${section}|${wsId ?? ""}`;
    if (sent.current === key) return;
    sent.current = key;
    void teamLogView({ data: { workspaceId: wsId ?? null, section } }).catch(() => {});
  }, [section, wsId]);
}
