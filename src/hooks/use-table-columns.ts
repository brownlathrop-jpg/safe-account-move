import { useCallback, useEffect, useRef, useState } from "react";

export type ColumnDef = {
  key: string;
  label: string;
  width: number;
  /** Нельзя скрыть */
  required?: boolean;
  /** Скрыт по умолчанию */
  hiddenByDefault?: boolean;
};

type Saved = { hidden?: string[]; widths?: Record<string, number> };

/**
 * Видимость и ширины колонок таблицы с запоминанием в браузере.
 */
export function useTableColumns(storageKey: string, defs: ColumnDef[]) {
  const [hidden, setHidden] = useState<string[]>(() => defs.filter(d => d.hiddenByDefault).map(d => d.key));
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(defs.map(d => [d.key, d.width])),
  );
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Saved;
        if (Array.isArray(saved.hidden)) setHidden(saved.hidden.filter(k => defs.some(d => d.key === k && !d.required)));
        if (saved.widths) {
          setWidths(prev => {
            const next = { ...prev };
            for (const d of defs) {
              const w = saved.widths?.[d.key];
              if (typeof w === "number" && w >= 60) next[d.key] = w;
            }
            return next;
          });
        }
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ hidden, widths } satisfies Saved));
    } catch {
      /* ignore */
    }
  }, [storageKey, hidden, widths]);

  const isVisible = useCallback((key: string) => !hidden.includes(key), [hidden]);

  const toggle = useCallback((key: string, on: boolean) => {
    setHidden(prev => (on ? prev.filter(k => k !== key) : prev.includes(key) ? prev : [...prev, key]));
  }, []);

  const reset = useCallback(() => {
    setHidden(defs.filter(d => d.hiddenByDefault).map(d => d.key));
    setWidths(Object.fromEntries(defs.map(d => [d.key, d.width])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs]);

  /** Начать перетаскивание правой границы колонки */
  const startResize = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key] ?? 120;
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(60, Math.round(startW + (ev.clientX - startX)));
      setWidths(prev => ({ ...prev, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [widths]);

  const visible = defs.filter(d => isVisible(d.key));

  return { defs, visible, widths, hidden, isVisible, toggle, reset, startResize };
}
