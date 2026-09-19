import { amountInWords } from "@/lib/amount-in-words";
import { PrintHeader } from "@/components/print/PrintHeader";
import type { PrintBrand } from "@/lib/print-header";

const nfmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export function Pko({
  org,
  number,
  date,
  partnerName,
  amount,
  basis,
}: {
  org?: (PrintBrand & { okpo?: string | null }) | null;
  number: string;
  date: string;
  partnerName?: string | null;
  amount: number;
  basis?: string | null;
}) {
  const safeDate = new Date(`${date}T00:00:00`);
  return (
    <div className="text-black" style={{ fontSize: 12 }}>
      <PrintHeader org={org} />
      <div className="mb-1 text-right text-xs">
        Унифицированная форма № КО-1<br />
        Утверждена постановлением Госкомстата России от 18.08.1998 № 88
      </div>
      <table className="mb-2 w-full border-collapse text-xs">
        <tbody>
          <tr>
            <td className="w-1/2 border border-black px-2 py-1 align-top">
              <div>Организация</div>
              <div className="font-semibold">{org?.print_name?.trim() || org?.name || "—"}</div>
            </td>
            <td className="w-32 border border-black px-2 py-1 text-center align-top">
              <div>Код по ОКПО</div>
              <div className="font-semibold">{org?.okpo || ""}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <h1 className="mt-4 text-center text-lg font-bold">ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР</h1>
      <table className="mb-4 mt-2 w-full border-collapse text-xs">
        <thead><tr><th className="w-24 border border-black px-2 py-1">Номер документа</th><th className="w-32 border border-black px-2 py-1">Дата составления</th></tr></thead>
        <tbody><tr><td className="border border-black px-2 py-1 text-center">{number}</td><td className="border border-black px-2 py-1 text-center">{dfmt.format(safeDate)}</td></tr></tbody>
      </table>
      <table className="mb-4 w-full border-collapse text-xs">
        <thead>
          <tr><th className="border border-black px-2 py-1" colSpan={2}>Дебет</th><th className="border border-black px-2 py-1" rowSpan={2}>Кредит</th><th className="border border-black px-2 py-1" rowSpan={2}>Сумма,<br />руб. коп.</th><th className="border border-black px-2 py-1" rowSpan={2}>Код целевого<br />назначения</th></tr>
          <tr><th className="border border-black px-2 py-1">Корреспондирующий<br />счёт, субсчёт</th><th className="border border-black px-2 py-1">Код аналитического<br />учёта</th></tr>
        </thead>
        <tbody><tr><td className="border border-black px-2 py-1 text-center">50</td><td className="border border-black px-2 py-1" /><td className="border border-black px-2 py-1 text-center">62</td><td className="border border-black px-2 py-1 text-right font-semibold">{nfmt.format(amount)}</td><td className="border border-black px-2 py-1" /></tr></tbody>
      </table>
      <div className="mb-2 text-sm"><b>Принято от:</b> {partnerName || "—"}</div>
      <div className="mb-2 text-sm"><b>Основание:</b> {basis || "Оплата по документу"}</div>
      <div className="mb-2 text-sm"><b>Сумма:</b> {amountInWords(amount)}</div>
      <div className="mb-2 text-sm"><b>В том числе:</b> без налога (НДС)</div>
      <div className="mb-4 text-sm"><b>Приложение:</b> _____________________________________</div>
      <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div><div>Главный бухгалтер</div><div className="mt-4 border-b border-black" /><div className="mt-1 text-center text-xs">подпись, расшифровка</div></div>
        <div><div>Получил кассир</div><div className="mt-4 border-b border-black" /><div className="mt-1 text-center text-xs">подпись, расшифровка</div></div>
      </div>
      <div className="my-6 border-t-2 border-dashed border-black" />
      <div>
        <h2 className="text-center text-base font-bold">КВИТАНЦИЯ</h2>
        <p className="mt-1 text-sm">к приходному кассовому ордеру № {number} от {dfmt.format(safeDate)}</p>
        <div className="mt-2 text-sm"><b>Принято от:</b> {partnerName || "—"}</div>
        <div className="mt-1 text-sm"><b>Основание:</b> {basis || "Оплата по документу"}</div>
        <div className="mt-1 text-sm"><b>Сумма:</b> {amountInWords(amount)}</div>
        <div className="mt-1 text-sm"><b>В том числе:</b> без налога (НДС)</div>
        <div className="mt-6 grid grid-cols-3 gap-4 text-sm"><div>«___» __________ {safeDate.getFullYear()} г.</div><div className="text-center">М.П. (штампа)</div><div /></div>
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm"><div><div>Главный бухгалтер</div><div className="mt-4 border-b border-black" /></div><div><div>Кассир</div><div className="mt-4 border-b border-black" /></div></div>
      </div>
    </div>
  );
}