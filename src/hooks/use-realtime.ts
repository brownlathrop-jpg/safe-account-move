// Мгновенное обновление данных: слушаем поток изменений и освежаем кэш запросов.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

type ChangeEvent = { table: string; id: string | null; workspace_id: string | null; op: string };

// Какие ключи запросов обновлять при изменении таблицы (первый элемент ключа — имя таблицы).
const EXTRA_KEYS: Record<string, string[]> = {
  stock_movements: ["stock_balances", "dashboard-stats"],
  stock_receipts: ["stock_balances"],
  stock_receipt_items: ["stock_balances", "stock_receipts"],
  invoice_items: ["invoices", "invoice", "invoice-children", "shipments", "dashboard-stats"],
  invoices: [
    "invoice", "invoice-children", "invoice-parent", "invoices-count",
    "shipments", "shipments-count", "cash", "cash-count",
    "stock_balances", "dashboard-stats",
  ],
  workspace_members: ["team", "workspaces", "my-role"],
  invoice_payments: ["invoice", "invoices", "shipments", "partner-balance", "partner-docs", "dashboard-stats"],
  products: ["stock_balances", "dashboard-stats"],
  partners: ["partners-list", "dashboard-stats"],
  organizations: ["my-organization", "my-organization-mask"],
  workspaces: ["ws-settings"],
};

export function useRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let flush: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/realtime");

      // События приходят по одному на каждую изменённую строку. При массовых
      // операциях (удаление папки, перенос товаров) их сотни — копим их и
      // обновляем кэш один раз, иначе список перезагружается сотни раз.
      es.onmessage = (e) => {
        let event: ChangeEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!event?.table) return;
        pending.add(event.table);
        for (const extra of EXTRA_KEYS[event.table] ?? []) pending.add(extra);
        if (flush) return;
        flush = setTimeout(() => {
          flush = null;
          const keys = Array.from(pending);
          pending.clear();
          for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
        }, 250);
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
      if (flush) clearTimeout(flush);
      es?.close();
    };
  }, [qc]);
}
