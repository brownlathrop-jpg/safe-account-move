// In-memory + localStorage draft для новой заявки.
// Пока пользователь в SPA-сессии, состояние переживает любые переходы между меню.

export type DraftItem = {
  product_id: string | null;
  name: string;
  quantity: number;
  price: number;
  kind: "product" | "service";
};

export type InvoiceDraft = {
  kind: "outgoing" | "incoming";
  number: string;
  date: string;
  partnerId: string;
  statusId: string;
  note: string;
  items: DraftItem[];
  numberTouched: boolean;
};

const KEY = "invoice-new-draft-v2";

const empty = (): InvoiceDraft => ({
  kind: "outgoing",
  number: "",
  date: new Date().toISOString().slice(0, 10),
  partnerId: "",
  statusId: "",
  note: "",
  items: [],
  numberTouched: false,
});

let state: InvoiceDraft = load();
const listeners = new Set<() => void>();

function load(): InvoiceDraft {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<InvoiceDraft>;
    return { ...empty(), ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return empty();
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export const invoiceDraft = {
  get: () => state,
  set: (patch: Partial<InvoiceDraft>) => {
    state = { ...state, ...patch };
    persist();
    listeners.forEach((l) => l());
  },
  reset: () => {
    state = empty();
    if (typeof window !== "undefined") { try { localStorage.removeItem(KEY); } catch {} }
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  hasContent: (): boolean => {
    return (
      state.items.length > 0 ||
      !!state.partnerId ||
      !!state.note.trim() ||
      state.numberTouched
    );
  },
};
