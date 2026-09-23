import { useEffect, useState } from "react";
import { paymentQrDataUrl, type PaymentQrData } from "@/lib/payment-qr";

/**
 * Платёжный QR-код для счёта: покупатель наводит камеру банковского
 * приложения и оплачивает счёт без ручного ввода реквизитов.
 */
export function PaymentQr({
  data,
  size = 150,
  caption = "Оплата по QR-коду: наведите камеру в приложении банка",
}: {
  data: PaymentQrData;
  size?: number;
  caption?: string;
}) {
  const [img, setImg] = useState("");
  const key = JSON.stringify(data);

  useEffect(() => {
    let alive = true;
    paymentQrDataUrl(data, size * 3).then((v) => {
      if (alive) setImg(v);
    });
    return () => {
      alive = false;
    };
    // data сравниваем по содержимому, чтобы не пересоздавать код на каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);

  if (!img) return null;
  return (
    <div className="text-center" style={{ width: size }}>
      <img src={img} alt="QR-код для оплаты счёта" width={size} height={size} />
      <div className="mt-1 leading-tight" style={{ fontSize: 8 }}>
        {caption}
      </div>
    </div>
  );
}
