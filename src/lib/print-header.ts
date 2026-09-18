/**
 * Единая шапка печатных документов: логотип + название организации + реквизиты.
 * Используется и в React-формах (PrintHeader), и в HTML-печати (printHeaderHtml).
 */

export type PrintBrand = {
  name?: string | null;
  /** Название специально для печати (если задано — печатаем его). */
  print_name?: string | null;
  /** Логотип: data URL или ссылка. */
  logo_url?: string | null;
  inn?: string | null;
  kpp?: string | null;
  legal_address?: string | null;
  phone?: string | null;
  email?: string | null;
  site?: string | null;
};

/** Единые размеры бокса логотипа при печати — одинаковые во всех документах. */
export const PRINT_LOGO_BOX = { width: 170, height: 56 };

export function brandName(org?: PrintBrand | null): string {
  return (org?.print_name?.trim() || org?.name?.trim() || "") as string;
}

/** Строка реквизитов под названием. */
export function brandDetails(org?: PrintBrand | null): string {
  if (!org) return "";
  return [
    org.inn ? `ИНН ${org.inn}` : "",
    org.kpp ? `КПП ${org.kpp}` : "",
    org.legal_address || "",
    org.phone ? `тел. ${org.phone}` : "",
    org.email || "",
    org.site || "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML-шапка для печати в отдельном окне (списки, кассовая книга, КУДиР). */
export function printHeaderHtml(org?: PrintBrand | null): string {
  const name = brandName(org);
  const details = brandDetails(org);
  if (!name && !org?.logo_url) return "";
  const logo = org?.logo_url
    ? `<div style="width:${PRINT_LOGO_BOX.width}px;height:${PRINT_LOGO_BOX.height}px;flex:0 0 auto;display:flex;align-items:center;">
         <img src="${esc(org.logo_url)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" />
       </div>`
    : "";
  return `<div style="display:flex;align-items:center;gap:12px;border-bottom:1.5px solid #000;padding-bottom:8px;margin-bottom:12px;">
  ${logo}
  <div style="min-width:0;">
    ${name ? `<div style="font-size:15px;font-weight:bold;line-height:1.2;">${esc(name)}</div>` : ""}
    ${details ? `<div style="font-size:10px;color:#333;margin-top:2px;">${esc(details)}</div>` : ""}
  </div>
</div>`;
}
