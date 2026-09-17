export type PrintParty = {
  name?: string | null;
  inn?: string | null;
  kpp?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_bik?: string | null;
  bank_account?: string | null;
  bank_corr_account?: string | null;
} | null;

export type PrintItem = {
  name: string;
  unit: string;
  quantity: number;
  price: number;
};

export const nfmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export function partyLine(p: PrintParty): string {
  if (!p) return "—";
  return [p.name, p.address, p.inn ? `ИНН ${p.inn}` : "", p.kpp ? `КПП ${p.kpp}` : "", p.phone ? `тел. ${p.phone}` : ""]
    .filter(Boolean)
    .join(", ");
}
