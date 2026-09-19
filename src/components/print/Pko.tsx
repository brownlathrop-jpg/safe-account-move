import { amountInWords } from "@/lib/amount-in-words";
import type { PrintBrand } from "@/lib/print-header";

const nfmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Подчёркнутое поле бланка: значение над линией, подпись под линией. */
function Field({ value, caption, className = "" }: { value?: string; caption?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="border-b border-black px-1 leading-5 min-h-5">{value || "\u00A0"}</div>
      {caption ? <div className="text-center leading-3" style={{ fontSize: 7 }}>{caption}</div> : null}
    </div>
  );
}

/**
 * Приходный кассовый ордер по унифицированной форме № КО-1
 * (постановление Госкомстата России от 18.08.1998 № 88).
 * Ордер печатается слева, отрезная квитанция — справа по линии отреза.
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
  const b = "border border-black";

  return (
    <div className="text-black" style={{ fontSize: 9, lineHeight: 1.25 }}>
      <div className="flex items-stretch">
        {/* ==================== ОРДЕР ==================== */}
        <div style={{ width: "62%", paddingRight: 8 }}>
          <div className="text-right" style={{ fontSize: 8 }}>Унифицированная форма № КО-1</div>
          <div className="text-right" style={{ fontSize: 8 }}>
            Утверждена постановлением Госкомстата России от 18.08.98 № 88
          </div>

          <table className="mt-2 w-full border-collapse">
            <tbody>
              <tr>
                <td className="align-bottom" style={{ width: "70%" }}>
                  <Field value={orgName} caption="организация" />
                </td>
                <td className="align-bottom" style={{ width: "30%" }}>
                  <div className="flex items-end gap-1">
                    <span style={{ fontSize: 8 }}>Код по ОКПО</span>
                    <div className={`${b} flex-1 px-1 text-center`} style={{ minHeight: 16 }}>{org?.okpo || "\u00A0"}</div>
                  </div>
                </td>
              </tr>
              <tr>
                <td className="align-bottom pt-2" colSpan={2}>
                  <Field caption="структурное подразделение" />
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 text-center font-bold" style={{ fontSize: 11 }}>ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР</div>

          <table className="mx-auto mt-1 border-collapse text-center" style={{ fontSize: 8 }}>
            <thead>
              <tr>
                <th className={`${b} px-2 py-px`} style={{ width: 90 }}>Номер документа</th>
                <th className={`${b} px-2 py-px`} style={{ width: 90 }}>Дата составления</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${b} px-2 py-1`}>{number}</td>
                <td className={`${b} px-2 py-1`}>{dateStr}</td>
              </tr>
            </tbody>
          </table>

          <table className="mt-2 w-full border-collapse text-center" style={{ fontSize: 8 }}>
            <thead>
              <tr>
                <th className={`${b} px-1`} colSpan={2}>Дебет</th>
                <th className={`${b} px-1`} rowSpan={2}>Кредит</th>
                <th className={`${b} px-1`} rowSpan={2}>Сумма,<br />руб. коп.</th>
                <th className={`${b} px-1`} rowSpan={2}>Код целевого<br />назначения</th>
              </tr>
              <tr>
                <th className={`${b} px-1`}>корреспондирующий<br />счёт, субсчёт</th>
                <th className={`${b} px-1`}>код аналитического<br />учёта</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${b} px-1 py-1`}>50</td>
                <td className={`${b} px-1 py-1`}>&nbsp;</td>
                <td className={`${b} px-1 py-1`}>62</td>
                <td className={`${b} px-1 py-1 text-right font-semibold`}>{nfmt.format(amount)}</td>
                <td className={`${b} px-1 py-1`}>&nbsp;</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 flex items-end gap-1">
            <span>Принято от</span>
            <Field className="flex-1" value={partnerName || ""} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Основание</span>
            <Field className="flex-1" value={reason} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Сумма</span>
            <Field className="flex-1" value={words} caption="прописью" />
          </div>
          <div className="mt-1 flex items-end gap-1">
            <span>В том числе</span>
            <Field className="flex-1" value={vatNote} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Приложение</span>
            <Field className="flex-1" value={application || ""} />
          </div>

          <div className="mt-4 flex items-end gap-2">
            <span>Главный бухгалтер</span>
            <Field className="flex-1" caption="подпись" />
            <Field className="flex-1" value={org?.director_name || ""} caption="расшифровка подписи" />
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span>Получил кассир</span>
            <Field className="flex-1" caption="подпись" />
            <Field className="flex-1" caption="расшифровка подписи" />
          </div>
        </div>

        {/* ==================== ЛИНИЯ ОТРЕЗА ==================== */}
        <div className="relative" style={{ width: 14 }}>
          <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-black" />
        </div>

        {/* ==================== КВИТАНЦИЯ ==================== */}
        <div style={{ width: "38%", paddingLeft: 8 }}>
          <div className="text-center font-bold" style={{ fontSize: 10 }}>КВИТАНЦИЯ</div>
          <div className="mt-2 flex items-end gap-1">
            <span>к приходному кассовому ордеру №</span>
            <Field className="flex-1" value={number} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>от</span>
            <Field className="flex-1" value={dateStr} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Принято от</span>
            <Field className="flex-1" value={partnerName || ""} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Основание</span>
            <Field className="flex-1" value={reason} />
          </div>
          <div className="mt-2">
            <Field value={words} caption="сумма прописью" />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>В том числе</span>
            <Field className="flex-1" value={vatNote} />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <span>Сумма</span>
            <div className={`${b} flex-1 px-1 text-right font-semibold`} style={{ minHeight: 16 }}>
              {nfmt.format(amount)}
            </div>
          </div>
          <div className="mt-3">«____» _______________ {safeDate.getFullYear()} г.</div>
          <div className="mt-3 text-center" style={{ fontSize: 8 }}>М.П. (штампа)</div>
          <div className="mt-4 flex items-end gap-2">
            <span>Главный бухгалтер</span>
            <Field className="flex-1" caption="подпись" />
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span>Кассир</span>
            <Field className="flex-1" caption="подпись" />
          </div>
        </div>
      </div>
    </div>
  );
}
