import { amountInWords } from "@/lib/amount-in-words";
import { type PrintItem, type PrintParty, dfmt, nfmt } from "./print-types";

/**
 * Универсальный передаточный документ (УПД) по рекомендуемой форме
 * из приложения № 1 к письму ФНС России от 21.10.2013 № ММВ-20-3/96@.
 * Статус 2 — передаточный документ (акт). Строки (1)–(8), графы А, Б, 1–11,
 * передаточная часть строк (8)–(19).
 */
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
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const net = (i: PrintItem) => r2(i.netSum ?? i.quantity * i.price);
  const vat = (i: PrintItem) => r2(i.vatSum ?? 0);
  const gross = (i: PrintItem) => r2(i.grossSum ?? net(i) + vat(i));
  const rateText = (i: PrintItem) => (i.vatRate === null || i.vatRate === undefined || !i.vatRate ? "без НДС" : `${i.vatRate} %`);
  const netTotal = r2(items.reduce((s, i) => s + net(i), 0));
  const vatTotal = r2(items.reduce((s, i) => s + vat(i), 0));
  const total = r2(items.reduce((s, i) => s + gross(i), 0));
  const b = "border border-black px-1 py-0.5 align-top";
  const d = new Date(date);
  const nm = (p: PrintParty) => p?.name || "—";
  const innKpp = (p: PrintParty) => [p?.inn, p?.kpp].filter(Boolean).join(" / ") || "—";

  /** Строка бланка: подпись слева, значение по линии, номер строки справа. */
  const Row = ({ label, value, code }: { label: string; value?: string; code: string }) => (
    <div className="flex items-end gap-2 mb-0.5">
      <div style={{ minWidth: 210 }}>{label}</div>
      <div className="flex-1 border-b border-black">{value ?? "\u00a0"}</div>
      <div style={{ width: 28 }} className="text-right">({code})</div>
    </div>
  );

  return (
    <div style={{ fontSize: 10, lineHeight: 1.3 }}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 pr-3">
          <h1 className="text-sm font-bold mb-1">Универсальный передаточный документ</h1>
          <Row label="Счёт-фактура №" value={`${number} от ${dfmt.format(d)}`} code="1" />
          <Row label="Исправление №" value="— от —" code="1а" />
        </div>
        <div className="border border-black px-2 py-1 text-center" style={{ minWidth: 190 }}>
          <div>Статус: <b>2</b></div>
          <div className="text-[8px] text-left mt-1">
            1 — счёт-фактура и передаточный документ (акт)<br />
            2 — передаточный документ (акт)
          </div>
        </div>
      </div>

      {/* Строки (2)–(8) */}
      <div className="mb-2">
        <Row label="Продавец" value={nm(supplier)} code="2" />
        <Row label="Адрес" value={supplier?.address || "—"} code="2а" />
        <Row label="ИНН/КПП продавца" value={innKpp(supplier)} code="2б" />
        <Row label="Грузоотправитель и его адрес" value="он же" code="3" />
        <Row label="Грузополучатель и его адрес" value="он же" code="4" />
        <Row label="К платёжно-расчётному документу" value="—" code="5" />
        <Row label="Покупатель" value={nm(buyer)} code="6" />
        <Row label="Адрес" value={buyer?.address || "—"} code="6а" />
        <Row label="ИНН/КПП покупателя" value={innKpp(buyer)} code="6б" />
        <Row label="Валюта: наименование, код" value="Российский рубль, 643" code="7" />
        <Row label="Идентификатор государственного контракта, договора (соглашения)" value="—" code="8" />
      </div>

      {/* Табличная часть: графы А, Б, 1, 1а, 2, 2а, 3–11 */}
      <table className="w-full border-collapse" style={{ fontSize: 9 }}>
        <thead>
          <tr>
            <th className={`${b} text-center`} rowSpan={2}>№ п/п</th>
            <th className={`${b} text-center`} rowSpan={2}>Код товара/работ, услуг</th>
            <th className={`${b} text-center`} rowSpan={2}>Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th>
            <th className={`${b} text-center`} rowSpan={2}>Код вида товара</th>
            <th className={`${b} text-center`} colSpan={2}>Единица измерения</th>
            <th className={`${b} text-center`} rowSpan={2}>Количество (объём)</th>
            <th className={`${b} text-center`} rowSpan={2}>Цена (тариф) за единицу измерения</th>
            <th className={`${b} text-center`} rowSpan={2}>Стоимость товаров (работ, услуг), имущественных прав без налога — всего</th>
            <th className={`${b} text-center`} rowSpan={2}>В том числе сумма акциза</th>
            <th className={`${b} text-center`} rowSpan={2}>Налоговая ставка</th>
            <th className={`${b} text-center`} rowSpan={2}>Сумма налога, предъявляемая покупателю</th>
            <th className={`${b} text-center`} rowSpan={2}>Стоимость товаров (работ, услуг), имущественных прав с налогом — всего</th>
            <th className={`${b} text-center`} colSpan={2}>Страна происхождения товара</th>
            <th className={`${b} text-center`} rowSpan={2}>Регистрационный номер декларации на товары</th>
          </tr>
          <tr>
            <th className={`${b} text-center`}>код</th>
            <th className={`${b} text-center`}>условное обозначение (национальное)</th>
            <th className={`${b} text-center`}>цифровой код</th>
            <th className={`${b} text-center`}>краткое наименование</th>
          </tr>
          <tr className="text-[8px]">
            {["А", "Б", "1", "1а", "2", "2а", "3", "4", "5", "6", "7", "8", "9", "10", "10а", "11"].map(c => (
              <th key={c} className={`${b} text-center`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={`${b} text-center`}>{i + 1}</td>
              <td className={b} />
              <td className={b}>{it.name}</td>
              <td className={`${b} text-center`}>—</td>
              <td className={b} />
              <td className={`${b} text-center`}>{it.unit}</td>
              <td className={`${b} text-right`}>{it.quantity}</td>
              <td className={`${b} text-right`}>{nfmt.format(it.price)}</td>
              <td className={`${b} text-right`}>{nfmt.format(net(it))}</td>
              <td className={`${b} text-center`}>без акциза</td>
              <td className={`${b} text-center`}>{rateText(it)}</td>
              <td className={`${b} text-right`}>{vat(it) ? nfmt.format(vat(it)) : "—"}</td>
              <td className={`${b} text-right`}>{nfmt.format(gross(it))}</td>
              <td className={b} />
              <td className={b} />
              <td className={b} />
            </tr>
          ))}
          <tr>
            <td className={`${b} text-right font-bold`} colSpan={8}>Всего к оплате</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(netTotal)}</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-center`}>Х</td>
            <td className={`${b} text-right font-bold`}>{vatTotal ? nfmt.format(vatTotal) : "—"}</td>
            <td className={`${b} text-right font-bold`}>{nfmt.format(total)}</td>
            <td className={b} colSpan={3} />
          </tr>
        </tbody>
      </table>

      <p className="mt-1">Всего к оплате прописью: <b>{amountInWords(total)}</b></p>

      {/* Подписи счёта-фактуры */}
      <div className="grid grid-cols-2 gap-8 mt-4">
        <div>
          <div className="border-b border-black mt-4" />
          <div className="text-[8px] text-center">Руководитель организации или иное уполномоченное лицо (подпись, ф.и.о.)</div>
        </div>
        <div>
          <div className="border-b border-black mt-4" />
          <div className="text-[8px] text-center">Главный бухгалтер или иное уполномоченное лицо (подпись, ф.и.о.)</div>
        </div>
      </div>

      {/* Передаточная часть: строки (8)–(19) */}
      <div className="mt-4">
        <Row label="Основание передачи (сдачи) / получения (приёмки)" value={note || "Основной договор"} code="8" />
        <Row label="Данные о транспортировке и грузе" value="—" code="9" />
      </div>

      <div className="grid grid-cols-2 gap-8 mt-3">
        <div className="space-y-3">
          <div>
            <div>Товар (груз) передал / услуги, результаты работ, права сдал <span className="float-right">(10)</span></div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, ф.и.о.</div>
          </div>
          <div>Дата отгрузки, передачи (сдачи): <b>{dfmt.format(d)}</b> <span className="float-right">(11)</span></div>
          <div>
            <div>Иные сведения об отгрузке, передаче <span className="float-right">(12)</span></div>
            <div className="border-b border-black mt-4" />
          </div>
          <div>
            <div>Ответственный за правильность оформления факта хозяйственной жизни <span className="float-right">(13)</span></div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, ф.и.о.</div>
          </div>
          <div>
            <div>Наименование экономического субъекта — составителя документа <span className="float-right">(14)</span></div>
            <div className="border-b border-black mt-4">{nm(supplier)}</div>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div>Товар (груз) получил / услуги, результаты работ, права принял <span className="float-right">(15)</span></div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, ф.и.о.</div>
          </div>
          <div>Дата получения (приёмки): «___» __________ {d.getFullYear()} г. <span className="float-right">(16)</span></div>
          <div>
            <div>Иные сведения о получении, приёмке <span className="float-right">(17)</span></div>
            <div className="border-b border-black mt-4" />
          </div>
          <div>
            <div>Ответственный за правильность оформления факта хозяйственной жизни <span className="float-right">(18)</span></div>
            <div className="border-b border-black mt-4" />
            <div className="text-[8px] text-center">должность, подпись, ф.и.о.</div>
          </div>
          <div>
            <div>Наименование экономического субъекта — составителя документа <span className="float-right">(19)</span></div>
            <div className="border-b border-black mt-4">{nm(buyer)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-right">М.П.</div>
    </div>
  );
}
