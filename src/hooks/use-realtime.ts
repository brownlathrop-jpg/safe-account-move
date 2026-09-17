// Мгновенное обновление данных: слушаем поток изменений и освежаем кэш запросов.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

type ChangeEvent = { table: string; id: string | null; workspace_id: string | null; op: string };

// Какие ключи запросов обновлять при изменении таблицы (первый элемент ключа — имя таблицы).
const EXTRA_KEYS: Record<string, string[]> = {
  stock_movements: ["stock_balances"],
  stock_receipts: ["stock_balances"],
  stock_receipt_items: ["stock_balances", "stock_receipts"],
  invoice_items: ["invoices", "shipments-count"],
  invoices: ["shipments-count", "stock_balances"],
  organizations: ["my-organization"],
};

export function useRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/realtime");

      es.onmessage = (e) => {
        let event: ChangeEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!event?.table) return;
        const keys = [event.table, ...(EXTRA_KEYS[event.table] ?? [])];
        for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [qc]);
}
