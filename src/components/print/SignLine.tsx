/**
 * Подпись на печатной форме: линия с расшифровкой, поверх которой при
 * необходимости печатается факсимиле подписи и печать организации.
 */
export function SignLine({
  caption,
  name,
  signUrl,
  stampUrl,
  width = 240,
}: {
  caption: string;
  name?: string | null;
  signUrl?: string | null;
  stampUrl?: string | null;
  width?: number;
}) {
  return (
    <div className="text-sm" style={{ width }}>
      <div className="mb-1">{caption}</div>
      <div className="relative" style={{ height: 46 }}>
        {stampUrl ? (
          <img
            src={stampUrl}
            alt=""
            style={{
              position: "absolute",
              left: width - 90,
              top: -18,
              width: 110,
              height: 110,
              objectFit: "contain",
              opacity: 0.92,
            }}
          />
        ) : null}
        {signUrl ? (
          <img
            src={signUrl}
            alt=""
            style={{ position: "absolute", left: 20, top: 2, height: 38, objectFit: "contain" }}
          />
        ) : null}
        <div className="absolute bottom-0 left-0 right-0 border-b border-black" />
      </div>
      <div className="mt-0.5 leading-tight" style={{ fontSize: 9 }}>
        {name || "\u00A0"}
      </div>
    </div>
  );
}
