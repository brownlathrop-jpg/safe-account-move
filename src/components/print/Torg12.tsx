import { amountInWords } from "@/lib/amount-in-words";
import { type PrintItem, type PrintParty, dfmt, nfmt } from "./print-types";

/**
 * Товарная накладная по унифицированной форме № ТОРГ-12 (ОКУД 0330212),
 * утверждённой постановлением Госкомстата России от 25.12.1998 № 132.
 * Структура строк и 15 граф таблицы соответствуют бланку.
 */
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
  const b = "border border-black px-1 py-0.5 align-top";
  const d = new Date(date);
  const party = (p: PrintParty) => p?.name || "—";
  const fill = "border-b border-black inline-block min-w-[60%] align-bottom";
  const rub = Math.floor(total);
  const kop = Math.round((total - rub) * 100);

  return (
    <div style={{ fontSize: 10, lineHeight: 1.25 }}>
      {/* Шапка бланка */}
      <div className="flex justify-between items-start mb-1">
        <div style={{ width: "72%" }}>
          <div className="mb-1">
            <span className={fill}>{party(supplier)}</span>
            <div className="text-[8px]">организация-грузоотправитель, адрес, телефон, факс, банковские реквизиты</div>
          </div>
          <div className="mb-1">
            <span className={fill}>&nbsp;</span>
            <div className="text-[8px]">структурное подразделение</div>
          </div>
          <div className="mb-1">Грузополучатель <span className={fill}>{party(buyer)}</span>
            <div className="text-[8px]">организация, адрес, телефон, факс, банковские реквизиты</div>
          </div>
          <div className="mb-1">Поставщик <span className={fill}>{party(supplier)}</span>
            <div className="text-[8px]">организация, адрес, телефон, факс, банковские реквизиты</div>
          </div>
          <div className="mb-1">Плательщик <span className={fill}>{party(buyer)}</span>
            <div className="text-[8px]">организация, адрес, телефон, факс, банковские реквизиты</div>
          </div>
          <div className="mb-1">Основание <span className={fill}>{note || "Основной договор"}</span>
            <div className="text-[8px]">договор, заказ-наряд</div>
          </div>
        </div>
        <div style={{ width: "26%" }}>
          <div className="text-[9px] text-center border border-black px-1 py-0.5 mb-1">
            Унифицированная форма № ТОРГ-12<br />
            Утверждена постановлением Госкомстата России от 25.12.98 № 132
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr><td className={b}>Форма по ОКУД</td><td className={`${b} text-center`}>0330212</td></tr>
              <tr><td className={b}>по ОКПО</td><td className={b} /></tr>
              <tr><td className={b}>Вид деятельности по ОКДП</td><td className={b} /></tr>
              <tr><td className={b}>Основание: номер</td><td className={b} /></tr>
              <tr><td className={b}>дата</td><td className={b} /></tr>
              <tr><td className={b}>Транспортная накладная: номер</td><td className={b} /></tr>
              <tr><td className={b}>дата</td><td className={b} /></tr>
              <tr><td className={b}>Вид операции</td><td className={b} /></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Название и номер/дата */}
      <div className="flex justify-center items-end gap-2 my-2">
        <h1 className="text-sm font-bold">ТОВАРНАЯ НАКЛАДНАЯ</h1>
        <table className="border-collapse">
          <thead>
            <tr>
              <th className={`${b} text-center text-[9px]`}>Номер документа</th>
              <th className={`${b} text-center text-[9px]`}>Дата составления</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${b} text-center`}>{number}</td>
              <td className={`${b} text-center`}>{dfmt.format(d)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Таблица товаров: 15 граф бланка */}
      <table className="w-full border-collapse" style={{ fontSize: 9 }}>
        <thead>
          <tr>
            <th className={`${b} text-center`} rowSpan={2}>Номер по порядку</th>
            <th className={`${b} text-center`} colSpan={2}>Товар</th>
            <th className={`${b} text-center`} colSpan={2}>Единица измерения</th>
            <th className={`${b} text-center`} rowSpan={2}>Вид упаковки</th>
            <th className={`${b} text-center`} colSpan={2}>Количество</th>
            <th className={`${b} text-center`} rowSpan={2}>Масса брутто</th>
            <th className={`${b} text-center`} rowSpan={2}>Количество (масса нетто)</th>
            <th className={`${b} text-center`} rowSpan={2}>Цена, руб. коп.</th>
            <th className={`${b} text-center`} rowSpan={2}>Сумма без учёта НДС, руб. коп.</th>
            <th className={`${b} text-center`} colSpan={2}>НДС</th>
            <th className={`${b} text-center`} rowSpan={2}>Сумма с учётом НДС, руб. коп.</th>
          </tr>
          <tr>
            <th className={`${b} text-center`}>наименование, характеристика, сорт, артикул товара</th>
            <th className={`${b} text-center`}>код</th>
            <th className={`${b} text-center`}>наименование</th>
            <th className={`${b} text-center`}>код по ОКЕИ</th>
            <th className={`${b} text-center`}>в одном месте</th>
            <th className={`${b} text-center`}>мест, штук</th>
            <th className={`${b} text-center`}>ставка, %</th>
            <th className={`${b} text-center`}>сумма, руб. коп.</th>
          </tr>
          <tr className="text-[8px]">
            {Array.from({ length: 15 }, (_, i) => (
              <th key={i} className={`${b} text-center`}>{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={`${b} text-center`}>{i + 1}</td>
              <td className={b}>{it.name}</td>
              <td className={b} />
              <td className={`${b} text-center`}>{it.unit}</td>
              <td className={b} />
              <td className={b} />
              <td className={b} />
              <td className={b} />
              <td className={b} />
              <td className={`${b} text-right`}>{it.quantity}</td>
              <td className={`${b} text-right`}>{nfmt.format(it.price)}</td>
              <td className={`${b} text-right`}>{nfmt.format(it.quantity * it.price)}</td>
              <td className={`${b} text-center`}>без НДС</td>
              <td className={`${b} text-center`}>—</td>
              <td className={`${b} text-right`}>{nfmt.format(it.quantity * it.price)}</td>
            </tr>
          ))}
          <tr>
            <td className={`${b} text-right font-bold`} colSpan={9}>Итого</td>
            <td className={`${b} text-right font-bold`}>{qtyTotal}</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-center`}>—</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
          </tr>
          <tr>
            <td className={`${b} text-right font-bold`} colSpan={9}>Всего по накладной</td>
            <td className={`${b} text-right font-bold`}>{qtyTotal}</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-center`}>—</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Итоговые строки бланка */}
      <div className="mt-2 space-y-1">
        <div>Товарная накладная имеет приложение на <span className="border-b border-black inline-block w-32" /> листах
          <span className="text-[8px]"> (прописью)</span>
        </div>
        <div>и содержит <span className="border-b border-black inline-block w-32 text-center">{items.length}</span> номеров записей
          <span className="text-[8px]"> (прописью)</span>
        </div>
        <div>Масса груза (нетто) <span className="border-b border-black inline-block w-40" /></div>
        <div>Масса груза (брутто) <span className="border-b border-black inline-block w-40" /></div>
        <div>Всего отпущено на сумму <span className="border-b border-black inline-block min-w-[55%] font-bold">{amountInWords(total)}</span></div>
        <div>Сумма цифрами: <b>{nfmt.format(total)}</b> руб. ({rub} руб. {String(kop).padStart(2, "0")} коп.)</div>
      </div>

      {/* Подписи по бланку */}
      <div className="grid grid-cols-2 gap-8 mt-6">
        <div className="space-y-4">
          <div>
            <div>Отпуск груза разрешил</div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, расшифровка подписи</div>
          </div>
          <div>
            <div>Главный (старший) бухгалтер</div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">подпись, расшифровка подписи</div>
          </div>
          <div>
            <div>Отпуск груза произвёл</div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, расшифровка подписи</div>
          </div>
          <div>«___» ______________ {d.getFullYear()} г.   М.П.</div>
        </div>
        <div className="space-y-4">
          <div>
            <div>По доверенности № _________ от «___» __________ {d.getFullYear()} г.</div>
            <div className="text-[8px]">выданной кем, кому (организация, должность, фамилия, и., о.)</div>
            <div className="border-b border-black mt-4" />
          </div>
          <div>
            <div>Груз получил грузополучатель</div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, расшифровка подписи</div>
          </div>
          <div>
            <div>Товар (груз) принял</div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, расшифровка подписи</div>
          </div>
          <div>«___» ______________ {d.getFullYear()} г.   М.П.</div>
        </div>
      </div>
    </div>
  );
}
