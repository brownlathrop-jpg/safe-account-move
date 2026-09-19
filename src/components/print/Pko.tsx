import { amountInWords } from "@/lib/amount-in-words";
import type { PrintBrand } from "@/lib/print-header";

const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Подчёркнутое поле бланка: значение над линией, подпись под линией. */
function Field({ value, caption, className = "" }: { value?: string; caption?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="border-b border-black px-1 leading-4 min-h-4 text-center">{value || "\u00A0"}</div>
      {caption ? <div className="text-center leading-3" style={{ fontSize: 6.5 }}>{caption}</div> : null}
    </div>
  );
}

function rubKop(amount: number): { rub: string; kop: string } {
  const kop = Math.round((amount - Math.floor(amount)) * 100);
  const rub = Math.floor(amount) + (kop >= 100 ? 1 : 0);
  return { rub: String(rub), kop: String(kop % 100).padStart(2, "0") };
}

/**
 * Приходный кассовый ордер по унифицированной форме № КО-1
 * (постановление Госкомстата России от 18.08.1998 № 88).
 * Макет как в утверждённом бланке: слева ордер, справа отрезная квитанция,
 * между ними вертикальная линия отреза. Лист А4 книжный.
 */
export function Pko({
  org,
  number,
  date,
  partnerName,
  amount,
  basis,
  vatNote = "без налога (НДС)",
  application,
}: {
  org?: (PrintBrand & { okpo?: string | null; director_name?: string | null }) | null;
  number: string;
  date: string;
  partnerName?: string | null;
  amount: number;
  basis?: string | null;
  vatNote?: string;
  application?: string | null;
}) {
  const safeDate = new Date(`${date}T00:00:00`);
  const dateStr = dfmt.format(safeDate);
  const orgName = org?.print_name?.trim() || org?.name || "";
  const words = amountInWords(amount);
  const reason = basis || "Оплата по документу";
  const { rub, kop } = rubKop(amount);
  const b = "border border-black";
  const th = `${b} px-0.5 leading-tight`;
  const td = `${b} px-0.5 py-1`;

  return (
    <div className="text-black flex" style={{ fontSize: 9, lineHeight: 1.2 }}>
      {/* ==================== ОРДЕР (левая часть) ==================== */}
      <div style={{ width: "63%" }} className="pr-2">
        <div className="text-right leading-tight" style={{ fontSize: 7 }}>
          Унифицированная форма № КО-1
          <br />
          Утверждена постановлением Госкомстата
          <br />
          России от 18.08.98 № 88
        </div>

        <table className="mt-1 w-full border-collapse">
          <tbody>
            <tr>
              <td className="align-bottom" style={{ width: "72%" }}>
                <Field value={orgName} caption="организация" />
              </td>
              <td className="align-bottom" style={{ width: "28%" }}>
                <table className="w-full border-collapse text-center" style={{ fontSize: 7 }}>
                  <tbody>
                    <tr>
                      <td className={th}>по ОКПО</td>
                    </tr>
                    <tr>
                      <td className={td}>{org?.okpo || "\u00A0"}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
        <Field caption="структурное подразделение" className="mt-0.5" />

        <div className="mt-2 flex items-end gap-2">
          <div className="font-bold whitespace-nowrap" style={{ fontSize: 11 }}>ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР</div>
          <table className="border-collapse text-center ml-auto" style={{ fontSize: 8 }}>
            <thead>
              <tr>
                <th className={`${th} font-normal`} style={{ width: 60 }}>Номер документа</th>
                <th className={`${th} font-normal`} style={{ width: 60 }}>Дата составления</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>{number}</td>
                <td className={td}>{dateStr}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table className="mt-1.5 w-full border-collapse text-center" style={{ fontSize: 8 }}>
          <thead>
            <tr>
              <th className={`${th} font-normal`} rowSpan={2}>Дебет</th>
              <th className={`${th} font-normal`} colSpan={2}>Кредит</th>
              <th className={`${th} font-normal`} rowSpan={2}>Сумма,<br />руб. коп.</th>
              <th className={`${th} font-normal`} rowSpan={2}>Код целевого<br />назначения</th>
            </tr>
            <tr>
              <th className={`${th} font-normal`}>корреспондирующий<br />счёт, субсчёт</th>
              <th className={`${th} font-normal`}>код аналитического<br />учёта</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>50</td>
              <td className={td}>62</td>
              <td className={td}>&nbsp;</td>
              <td className={`${td} font-semibold`}>{rub},{kop}</td>
              <td className={td}>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-1.5 flex items-end gap-1">
          <span className="whitespace-nowrap">Принято от</span>
          <Field className="flex-1" value={partnerName || ""} />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">Основание</span>
          <Field className="flex-1" value={reason} />
        </div>
        <Field className="mt-0.5" />
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">Сумма</span>
          <Field className="flex-1" value={words} caption="прописью" />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <Field className="flex-1" value={`${rub} руб. ${kop} коп.`} />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">В том числе</span>
          <Field className="flex-1" value={vatNote} />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">Приложение</span>
          <Field className="flex-1" value={application || ""} />
        </div>

        <div className="mt-3 flex items-end gap-1">
          <span className="whitespace-nowrap">Главный бухгалтер</span>
          <Field className="flex-1" caption="подпись" />
          <Field className="flex-1" value={org?.director_name || ""} caption="расшифровка подписи" />
        </div>
        <div className="mt-2 flex items-end gap-1">
          <span className="whitespace-nowrap">Получил кассир</span>
          <Field className="flex-1" caption="подпись" />
          <Field className="flex-1" caption="расшифровка подписи" />
        </div>
      </div>

      {/* ==================== ЛИНИЯ ОТРЕЗА ==================== */}
      <div className="border-l border-dashed border-black mx-1" />

      {/* ==================== КВИТАНЦИЯ (правая часть) ==================== */}
      <div style={{ width: "37%" }} className="pl-2 pt-8">
        <div className="text-center font-bold" style={{ fontSize: 10 }}>КВИТАНЦИЯ</div>
        <div className="mt-1 text-center" style={{ fontSize: 8 }}>
          к приходному кассовому ордеру № <span className="border-b border-black px-1">{number}</span>
        </div>
        <div className="mt-1 text-center" style={{ fontSize: 8 }}>
          от <span className="border-b border-black px-1">{dateStr}</span>
        </div>
        <div className="mt-2 flex items-end gap-1">
          <span className="whitespace-nowrap">Принято от</span>
          <Field className="flex-1" value={partnerName || ""} />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">Основание</span>
          <Field className="flex-1" value={reason} />
        </div>
        <Field className="mt-0.5" />
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">Сумма</span>
          <Field className="flex-1" value={`${rub} руб. ${kop} коп.`} caption="цифрами" />
        </div>
        <div className="mt-1">
          <Field value={words} caption="прописью" />
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="whitespace-nowrap">В том числе</span>
          <Field className="flex-1" value={vatNote} />
        </div>
        <div className="mt-2" style={{ fontSize: 8 }}>
          «____» _______________ {safeDate.getFullYear()} г.
        </div>
        <div className="mt-1 text-center" style={{ fontSize: 7 }}>М.П. (штампа)</div>
        <div className="mt-2 flex items-end gap-1">
          <span className="whitespace-nowrap">Главный бухгалтер</span>
          <Field className="flex-1" caption="подпись" />
        </div>
        <div className="mt-2 flex items-end gap-1">
          <span className="whitespace-nowrap">Кассир</span>
          <Field className="flex-1" caption="подпись" />
        </div>
      </div>
    </div>
  );
}
