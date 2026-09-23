// useState, который переживает переходы по меню: значение хранится
// в localStorage и восстанавливается после монтирования (SSR-безопасно).
import { useEffect, useRef, useState } from "react";

export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(initial);
  const restored = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
    restored.current = true;
  }, [key]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
