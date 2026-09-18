import { PRINT_LOGO_BOX, type PrintBrand, brandDetails, brandName } from "@/lib/print-header";

/**
 * Шапка печатного документа: логотип фиксированного размера + название и реквизиты.
 * Логотип всегда вписывается в один и тот же бокс, поэтому все документы
 * выглядят одинаково независимо от размера загруженной картинки.
 */
export function PrintHeader({ org }: { org?: PrintBrand | null }) {
  const name = brandName(org);
  const details = brandDetails(org);
  if (!name && !org?.logo_url) return null;

  return (
    <div className="flex items-center gap-3 border-b-2 border-black pb-2 mb-3">
      {org?.logo_url && (
        <div
          className="flex shrink-0 items-center"
          style={{ width: PRINT_LOGO_BOX.width, height: PRINT_LOGO_BOX.height }}
        >
          <img
            src={org.logo_url}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
      )}
      <div className="min-w-0">
        {name && <div className="text-base font-bold leading-tight">{name}</div>}
        {details && <div className="text-[10px] text-neutral-700 mt-0.5">{details}</div>}
      </div>
    </div>
  );
}
