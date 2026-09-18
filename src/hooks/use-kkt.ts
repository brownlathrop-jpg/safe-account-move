// Настройки кассы и печать чеков: адрес драйвера у каждого рабочего места,
// остальные настройки — общие для базы данных.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { userPrefsGet, userPrefsSet } from "@/lib/db.functions";
import {
  KKT_DEFAULTS, kktDeviceInfo, printSellReceipt, kktOpenShift, kktCloseShift,
  type KktSettings, type KktReceiptInput, type KktFiscalResult,
} from "@/lib/kkt-atol";

const LOCAL_URL_KEY = "kkt_driver_url";

/** Адрес драйвера кассы этого рабочего места. */
export function kktLocalUrl(): string {
  if (typeof window === "undefined") return KKT_DEFAULTS.url;
  return localStorage.getItem(LOCAL_URL_KEY) || KKT_DEFAULTS.url;
}

export function setKktLocalUrl(url: string) {
  if (typeof window !== "undefined") localStorage.setItem(LOCAL_URL_KEY, url || KKT_DEFAULTS.url);
}

type WsKkt = {
  kkt_enabled?: boolean;
  kkt_sno?: string;
  kkt_vat?: string;
  kkt_payment_method?: string;
  kkt_payment_object?: string;
  kkt_cashier?: string;
  kkt_cashier_vatin?: string;
  kkt_place?: string;
};

/** Настройки кассы для выбранной базы данных. */
export function useKktSettings(wsId: string | null | undefined) {
  const q = useQuery({
    queryKey: ["kkt-settings", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data } = await (db as any).from("workspaces").select("*").eq("id", wsId).maybeSingle();
      return (data ?? {}) as WsKkt;
    },
  });
  const prefs = useQuery({
    queryKey: ["user_prefs"],
    queryFn: async () => (await userPrefsGet()).prefs ?? {},
  });
  const ws = q.data ?? {};
  const url =
    (typeof window !== "undefined" && localStorage.getItem(LOCAL_URL_KEY)) ||
    ((prefs.data as any)?.kkt_url as string | undefined) ||
    KKT_DEFAULTS.url;
  const settings: KktSettings = {
    url,
    sno: (ws.kkt_sno as any) || KKT_DEFAULTS.sno,
    vat: (ws.kkt_vat as any) || KKT_DEFAULTS.vat,
    paymentMethod: ws.kkt_payment_method || KKT_DEFAULTS.paymentMethod,
    paymentObject: ws.kkt_payment_object || KKT_DEFAULTS.paymentObject,
    cashier: ws.kkt_cashier || "",
    cashierVatin: ws.kkt_cashier_vatin || "",
    place: ws.kkt_place || "",
  };
  return { settings, enabled: !!ws.kkt_enabled, isLoading: q.isLoading, raw: ws };
}

export function useSaveKktSettings(wsId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WsKkt & { url?: string }) => {
      const { url, ...wsPatch } = patch;
      if (url !== undefined) {
        setKktLocalUrl(url);
        await userPrefsSet({ data: { patch: { kkt_url: url } } });
      }
      if (Object.keys(wsPatch).length) {
        if (!wsId) throw new Error("Не выбрана база данных");
        const { error } = await (db as any).from("workspaces").update(wsPatch).eq("id", wsId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kkt-settings", wsId] });
      qc.invalidateQueries({ queryKey: ["user_prefs"] });
    },
  });
}

/** Проверка связи с кассой. */
export function useKktCheck(settings: KktSettings) {
  return useMutation({ mutationFn: () => kktDeviceInfo(settings) });
}

/** Состояние кассы и смены — чтобы до печати чека было видно, что не так. */
export function useKktShift(settings: KktSettings, enabled: boolean) {
  return useQuery({
    queryKey: ["kkt-shift", settings.url],
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => kktDeviceInfo(settings),
  });
}

/** Открыть смену / закрыть смену и открыть новую. */
export function useKktShiftAction(settings: KktSettings) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: "open" | "reopen") => {
      if (action === "reopen") {
        try {
          await kktCloseShift(settings);
        } catch (error) {
          throw new Error(`Не удалось закрыть смену: ${(error as Error).message}`);
        }
      }
      try {
        await kktOpenShift(settings);
      } catch (error) {
        const prefix = action === "reopen" ? "Смена закрыта, но новую открыть не удалось" : "Не удалось открыть смену";
        throw new Error(`${prefix}: ${(error as Error).message}`);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["kkt-shift", settings.url] }),
  });
}

/** Пробить чек по документу и сохранить фискальные данные в накладной. */
export function useKktPrintReceipt(settings: KktSettings, invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<KktFiscalResult, Error, KktReceiptInput>({
    mutationFn: async (input) => {
      const fiscal = await printSellReceipt(settings, input);
      const { error } = await (db as any).from("invoices").update({ fiscal }).eq("id", invoiceId);
      if (error) throw new Error(`Чек пробит, но не сохранился в накладной: ${error.message}`);
      return fiscal;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["doc-history", "invoices", invoiceId] });
    },
  });
}
