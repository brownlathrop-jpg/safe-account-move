import { amountInWords } from "@/lib/amount-in-words";
import { type PrintItem, type PrintParty, dfmt, nfmt, partyLine } from "./print-types";

/** Товарная накладная ТОРГ-12 (упрощённая, но с обязательными реквизитами). */
export function Torg12({
  supplier, buyer, number, date, items, note,
}: {
  supplier: PrintParty;
  buyer: PrintParty;
  number: string;
  date: string;
  items: PrintItem[];
  note?: string | null;
}) {
  const total = items.reduce((s, i) => s + i.quantity * i.price, 0);
  const qtyTotal = items.reduce((s, i) => s + i.quantity, 0);
  const b = "border border-black px-1 py-0.5";

  return (
    <div style={{ fontSize: 11 }}>
      <div className="text-right text-[10px] mb-1">Типовая форма № ТОРГ-12</div>
      <table className="w-full border-collapse mb-2">
        <tbody>
          <tr>
            <td className={b} style={{ width: "18%" }}>Грузоотправитель</td>
            <td className={b}>{partyLine(supplier)}</td>
          </tr>
          <tr>
            <td className={b}>Грузополучатель</td>
            <td className={b}>{partyLine(buyer)}</td>
          </tr>
          <tr>
            <td className={b}>Поставщик</td>
            <td className={b}>{partyLine(supplier)}</td>
          </tr>
          <tr>
            <td className={b}>Плательщик</td>
            <td className={b}>{partyLine(buyer)}</td>
          </tr>
          <tr>
            <td className={b}>Основание</td>
            <td className={b}>{note || "Основной договор"}</td>
          </tr>
        </tbody>
      </table>

      <h1 className="text-center text-base font-bold my-2">
        ТОВАРНАЯ НАКЛАДНАЯ № {number} от {dfmt.format(new Date(date))}
      </h1>

      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th className={b}>№</th>
            <th className={b}>Наименование, характеристика товара</th>
            <th className={b}>Ед. изм.</th>
            <th className={b}>Кол-во</th>
            <th className={b}>Цена, руб. коп.</th>
            <th className={b}>Сумма без НДС, руб. коп.</th>
            <th className={b}>НДС</th>
            <th className={b}>Сумма с НДС, руб. коп.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={`${b} text-center`}>{i + 1}</td>
              <td className={b}>{it.name}</td>
              <td className={`${b} text-center`}>{it.unit}</td>
              <td className={`${b} text-right`}>{it.quantity}</td>
              <td className={`${b} text-right`}>{nfmt.format(it.price)}</td>
              <td className={`${b} text-right`}>{nfmt.format(it.quantity * it.price)}</td>
              <td className={`${b} text-center`}>без НДС</td>
              <td className={`${b} text-right`}>{nfmt.format(it.quantity * it.price)}</td>
            </tr>
          ))}
          <tr>
            <td className={`${b} text-right font-bold`} colSpan={3}>Итого</td>
            <td className={`${b} text-right font-bold`}>{qtyTotal}</td>
            <td className={b} />
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
            <td className={`${b} text-center`}>—</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2">Всего наименований {items.length}, на сумму {nfmt.format(total)} руб.</p>
      <p className="font-bold">{amountInWords(total)}</p>

      <div className="grid grid-cols-2 gap-8 mt-8">
        <div>
          <div>Отпуск груза разрешил</div>
          <div className="border-b border-black mt-5" />
          <div className="text-[10px] text-center">должность, подпись, расшифровка</div>
          <div className="mt-4">Отпуск груза произвёл</div>
          <div className="border-b border-black mt-5" />
          <div className="text-[10px] text-center">должность, подпись, расшифровка</div>
        </div>
        <div>
          <div>Груз получил грузополучатель</div>
          <div className="border-b border-black mt-5" />
          <div className="text-[10px] text-center">должность, подпись, расшифровка</div>
          <div className="mt-6">«___» ______________ {new Date(date).getFullYear()} г.   М.П.</div>
        </div>
      </div>
    </div>
  );
}
