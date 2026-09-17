import { amountInWords } from "@/lib/amount-in-words";
import { type PrintItem, type PrintParty, dfmt, nfmt, partyLine } from "./print-types";

/** Универсальный передаточный документ (УПД), статус 2 — передаточный документ. */
export function Upd({
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
  const b = "border border-black px-1 py-0.5";

  return (
    <div style={{ fontSize: 11 }}>
      <div className="flex justify-between items-start">
        <h1 className="text-base font-bold">
          Универсальный передаточный документ № {number} от {dfmt.format(new Date(date))}
        </h1>
        <div className={`${b} text-center`} style={{ minWidth: 130 }}>
          Статус: <b>2</b><div className="text-[10px]">передаточный документ</div>
        </div>
      </div>

      <table className="w-full border-collapse my-2">
        <tbody>
          <tr>
            <td className={b} style={{ width: "22%" }}>Продавец</td>
            <td className={b}>{partyLine(supplier)}</td>
          </tr>
          <tr>
            <td className={b}>Банковские реквизиты продавца</td>
            <td className={b}>
              {[supplier?.bank_name, supplier?.bank_bik ? `БИК ${supplier.bank_bik}` : "", supplier?.bank_account ? `р/с ${supplier.bank_account}` : "", supplier?.bank_corr_account ? `к/с ${supplier.bank_corr_account}` : ""].filter(Boolean).join(", ") || "—"}
            </td>
          </tr>
          <tr>
            <td className={b}>Покупатель</td>
            <td className={b}>{partyLine(buyer)}</td>
          </tr>
          <tr>
            <td className={b}>Грузоотправитель</td>
            <td className={b}>он же</td>
          </tr>
          <tr>
            <td className={b}>Грузополучатель</td>
            <td className={b}>он же</td>
          </tr>
          <tr>
            <td className={b}>Основание передачи</td>
            <td className={b}>{note || "Основной договор"}</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            <th className={b}>№</th>
            <th className={b}>Наименование товара (описание работ, услуг)</th>
            <th className={b}>Ед. изм.</th>
            <th className={b}>Кол-во</th>
            <th className={b}>Цена за ед., руб.</th>
            <th className={b}>Стоимость без налога, руб.</th>
            <th className={b}>Налоговая ставка</th>
            <th className={b}>Сумма налога</th>
            <th className={b}>Стоимость с налогом, руб.</th>
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
              <td className={`${b} text-center`}>—</td>
              <td className={`${b} text-right`}>{nfmt.format(it.quantity * it.price)}</td>
            </tr>
          ))}
          <tr>
            <td className={`${b} text-right font-bold`} colSpan={5}>Всего к оплате</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
            <td className={b} />
            <td className={`${b} text-center`}>—</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2 font-bold">{amountInWords(total)}</p>

      <div className="grid grid-cols-2 gap-8 mt-8">
        <div>
          <div>Товар (груз) передал / услуги, результаты работ сдал</div>
          <div className="border-b border-black mt-5" />
          <div className="text-[10px] text-center">должность, подпись, расшифровка</div>
          <div className="mt-4">Дата отгрузки, передачи: {dfmt.format(new Date(date))}</div>
        </div>
        <div>
          <div>Товар (груз) получил / услуги, результаты работ принял</div>
          <div className="border-b border-black mt-5" />
          <div className="text-[10px] text-center">должность, подпись, расшифровка</div>
          <div className="mt-4">Дата получения, приёмки: «___» __________ {new Date(date).getFullYear()} г.</div>
        </div>
      </div>
    </div>
  );
}
