// Онлайн-касса АТОЛ: связь с локальным драйвером ККТ 10 (веб-сервер драйвера).
// Касса подключена к компьютеру продавца, поэтому запросы идут из браузера
// на локальный адрес драйвера, минуя наш сервер.

export type KktSno = "osn" | "usnIncome" | "usnIncomeOutcome" | "esn" | "patent";
export type KktVat = "none" | "vat0" | "vat10" | "vat20" | "vat110" | "vat120" | "vat5" | "vat7";
export type KktPaymentType = "cash" | "electronically";

export type KktSettings = {
  /** Адрес веб-сервера драйвера ККТ (рабочее место продавца). */
  url: string;
  /** Система налогообложения чека. */
  sno: KktSno;
  /** Ставка НДС по позициям. */
  vat: KktVat;
  /** Признак способа расчёта (полный расчёт, аванс и т.п.). */
  paymentMethod: string;
  /** Признак предмета расчёта (товар, услуга и т.п.). */
  paymentObject: string;
  /** Имя кассира в чеке. */
  cashier: string;
  /** ИНН кассира (не обязательно). */
  cashierVatin: string;
  /** Место расчётов (адрес магазина или сайт). */
  place: string;
};

export const KKT_DEFAULTS: KktSettings = {
  url: "http://localhost:16732",
  sno: "usnIncome",
  vat: "none",
  paymentMethod: "fullPayment",
  paymentObject: "commodity",
  cashier: "",
  cashierVatin: "",
  place: "",
};

export const SNO_LABELS: Record<KktSno, string> = {
  osn: "Общая (ОСН)",
  usnIncome: "УСН доход",
  usnIncomeOutcome: "УСН доход минус расход",
  esn: "ЕСХН",
  patent: "Патент",
};

export const VAT_LABELS: Record<KktVat, string> = {
  none: "Без НДС",
  vat0: "НДС 0%",
  vat5: "НДС 5%",
  vat7: "НДС 7%",
  vat10: "НДС 10%",
  vat20: "НДС 20%",
  vat110: "НДС 10/110",
  vat120: "НДС 20/120",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  fullPrepayment: "Предоплата 100%",
  prepayment: "Частичная предоплата",
  advance: "Аванс",
  fullPayment: "Полный расчёт",
  partialPayment: "Частичный расчёт и кредит",
  credit: "Передача в кредит",
  creditPayment: "Оплата кредита",
};

export const PAYMENT_OBJECT_LABELS: Record<string, string> = {
  commodity: "Товар",
  excise: "Подакцизный товар",
  job: "Работа",
  service: "Услуга",
  payment: "Платёж",
  another: "Иной предмет расчёта",
};

export type KktPosition = {
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  /** Товар или услуга — нужно для режима «услуги в стоимость товара». */
  kind?: "product" | "service";
  /** Ставка НДС по позиции; если не задана — берётся из настроек кассы. */
  vat?: KktVat;
  /** Итог по строке; если задан, в чек попадёт именно он. */
  amount?: number;
};

export type KktReceiptInput = {
  positions: KktPosition[];
  paymentType: KktPaymentType;
  /** Электронный чек: адрес покупателя (почта или телефон). */
  clientContact?: string;
  /** Идентификатор операции: защита от повторного чека. */
  operationId: string;
  /** Чек возврата продажи (возвратная накладная). */
  isReturn?: boolean;
  /** Получено наличными — для расчёта сдачи. */
  cashReceived?: number;
  /** Состояние смены, уже проверенное в окне печати — чтобы не опрашивать кассу снова. */
  knownShiftState?: "opened" | "closed" | "expired" | "unknown";
};

export type KktFiscalResult = {
  receiptNumber: number | null;
  shiftNumber: number | null;
  fiscalDocNumber: number | null;
  fiscalSign: string | null;
  fnNumber: string | null;
  regNumber: string | null;
  datetime: string;
  total: number;
  operationId: string;
  paymentType: KktPaymentType;
  /** Чек возврата продажи. */
  isReturn?: boolean;
};

export type KktDeviceInfo = {
  model: string;
  serial: string;
  fnNumber: string;
  regNumber: string;
  shiftState: "opened" | "closed" | "expired" | "unknown";
  shiftNumber: number | null;
  /** Системы налогообложения, зарегистрированные в кассе (из отчёта о регистрации). */
  taxSystems: string[];
  /** Рекомендуемая СНО для подстановки в настройки (первая из зарегистрированных). */
  suggestedSno: KktSno | null;
  /** Рекомендуемая ставка НДС (20% при ОСН, иначе «без НДС»). */
  suggestedVat: KktVat | null;
  /** ИНН организации из регистрации кассы. */
  orgVatin: string | null;
};

/** Ошибка кассы с понятным для продавца текстом. */
export class KktError extends Error {
  code: string | number | null;
  constructor(message: string, code: string | number | null = null) {
    super(message);
    this.name = "KktError";
    this.code = code;
  }
}

const HUMAN_ERRORS: Array<[RegExp, string]> = [
  [/paper|бумаг/i, "В кассе нет бумаги — заправьте чековую ленту и повторите."],
  [/cover|крышк/i, "Открыта крышка кассы — закройте её и повторите."],
  [/shift.*(expired|24)|смена.*24/i, "Смена открыта больше 24 часов — закройте смену на кассе."],
  [/shift.*(closed|not open)|смена закрыт/i, "Смена закрыта — откройте смену и повторите."],
  [/connection|connect|port|соедин|порт/i, "Касса не отвечает: проверьте кабель и питание кассы."],
  [/fn|фискальн.*накопител/i, "Проблема с фискальным накопителем — обратитесь в обслуживающую организацию."],
];

function humanize(raw: string): string {
  for (const [re, text] of HUMAN_ERRORS) if (re.test(raw)) return text;
  return raw || "Касса вернула ошибку без описания";
}

function base(url: string) {
  return (url || KKT_DEFAULTS.url).replace(/\/+$/, "");
}

async function driverFetch(url: string, path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(base(url) + path, {
      ...init,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new KktError(
      "Нет связи с драйвером кассы. Проверьте, что программа «Драйвер ККТ АТОЛ 10» запущена на этом компьютере, а адрес указан верно в Настройках → Касса.",
    );
  }
  if (!res.ok) throw new KktError(`Драйвер кассы ответил ошибкой (${res.status})`, res.status);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new KktError("Драйвер кассы вернул непонятный ответ");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ответ драйвера может приходить в нескольких форматах:
 *  - { results: [ { result: {...}, error: {...} } ] }   (веб-сервер ДТО10)
 *  - { results: [ { status: "ready", result: {...} } ] }
 *  - сам результат задания в корне ответа.
 * Возвращаем результат, как только он появился, либо null — задание ещё в работе.
 */
function pickResult(state: any, uuid: string): { done: boolean; result?: any; error?: any } {
  if (!state || typeof state !== "object") return { done: false };
  const arr: any[] = Array.isArray(state) ? state : (state.results ?? []);
  // В некоторых версиях ДТО10 GET /requests/{uuid} возвращает общую очередь.
  // Берём ответ именно нашего задания, а не первый элемент предыдущей операции.
  const r = arr.find((item) => item?.uuid === uuid || item?.requestUuid === uuid) ??
    (arr.length === 1 ? arr[0] : undefined);
  if (r) {
    if (r.error && (r.error.code || r.error.description || r.error.message)) return { done: true, error: r.error };
    const st = String(r.status ?? "").toLowerCase();
    if (st && !["ready", "completed", "done", "success"].includes(st)) return { done: false };
    const errorCode = Number(r.errorCode ?? 0);
    if (errorCode) {
      return {
        done: true,
        error: {
          code: errorCode,
          description: r.errorDescription ?? r.description ?? r.message ?? `Ошибка кассы ${errorCode}`,
        },
      };
    }
    if (r.result !== undefined && r.result !== null) return { done: true, result: r.result };
    // Нет status и нет result — задание выполнено без данных (например openShift).
    if (!st) return { done: true, result: r };
    return { done: true, result: r.result ?? r };
  }
  if (state.error && (state.error.code || state.error.description || state.error.message)) {
    return { done: true, error: state.error };
  }
  if (state.result !== undefined && state.result !== null) return { done: true, result: state.result };
  return { done: false };
}

const taskQueues = new Map<string, Promise<void>>();

/** Отправить задание драйверу и дождаться результата. */
async function runTask(url: string, task: Record<string, unknown>, timeoutMs = 60000) {
  const queueKey = base(url);
  const previous = taskQueues.get(queueKey) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  taskQueues.set(queueKey, previous.then(() => current));
  await previous.catch(() => undefined);
  try {
    return await runTaskInner(url, task, timeoutMs);
  } finally {
    release?.();
    if (taskQueues.get(queueKey) === current) taskQueues.delete(queueKey);
  }
}

async function runTaskInner(url: string, task: Record<string, unknown>, timeoutMs: number) {
  const uuid = crypto.randomUUID();
  const started = Date.now();
  const first = await driverFetch(url, "/requests", {
    method: "POST",
    body: JSON.stringify({ uuid, request: [task] }),
  });
  let state = first;
  // Частый опрос в начале (большинство заданий готовы за десятки миллисекунд),
  // затем интервал плавно растёт — чтобы не грузить драйвер при долгой печати.
  let delay = 60;
  while (Date.now() - started < timeoutMs) {
    const p = pickResult(state, uuid);
    if (p.done) {
      if (p.error) {
        throw new KktError(humanize(p.error.description ?? p.error.message ?? ""), p.error.code ?? null);
      }
      return p.result ?? {};
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 500);
    state = await driverFetch(url, `/requests/${uuid}`);
  }
  throw new KktError(
    "Ответ о результате чека не получен. Если чек напечатался, не пробивайте его повторно — сначала проверьте последний чек на кассе. Если чек не печатался, проверьте, что касса не занята тестом драйвера или 1С.",
  );
}


function parseShiftState(shift: any): KktDeviceInfo["shiftState"] {
  const rawState = shift?.shiftStatus?.state ?? shift?.shift?.state ?? shift?.state;
  const st = String(rawState ?? "").toLowerCase();
  // Разные версии драйвера отдают состояние смены словом или числом (0/1/2).
  return st === "opened" || st === "open" || st === "1"
    ? "opened"
    : st === "closed" || st === "close" || st === "0"
      ? "closed"
      : st === "expired" || st === "2"
        ? "expired"
        : "unknown";
}

/** Только состояние смены — один короткий запрос к кассе. */
export async function kktShiftState(s: KktSettings): Promise<KktDeviceInfo["shiftState"]> {
  const shift = await runTask(s.url, { type: "getShiftStatus" }, 15000).catch(() => null);
  return parseShiftState(shift);
}

/**
 * Драйвер АТОЛ прячет реквизиты кассы на разных уровнях ответа и под разными
 * именами (deviceInfo / fnInfo / regInfo, serial / serialNumber / fnNumber…).
 * Поэтому ищем значение по всем вложенным объектам, а не только в корне.
 */
function deepFind(obj: any, keys: string[], depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  for (const k of keys) {
    const v = (obj as any)[k];
    if (v != null && v !== "" && typeof v !== "object") return String(v);
  }
  for (const v of Object.values(obj)) {
    const found = deepFind(v, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

const SNO_VALUES: KktSno[] = ["osn", "usnIncome", "usnIncomeOutcome", "esn", "patent"];

/** Числовые коды систем налогообложения из ФФД (касса может отдавать битовую маску). */
const SNO_BITS: Array<[number, KktSno]> = [
  [1, "osn"],
  [2, "usnIncome"],
  [4, "usnIncomeOutcome"],
  [16, "esn"],
  [32, "patent"],
];

const SNO_ALIASES: Record<string, KktSno> = {
  osn: "osn",
  general: "osn",
  usnincome: "usnIncome",
  usn: "usnIncome",
  usnincomeoutcome: "usnIncomeOutcome",
  esn: "esn",
  eshn: "esn",
  agricultural: "esn",
  patent: "patent",
  psn: "patent",
};

function snoFromValue(v: unknown): KktSno[] {
  if (typeof v === "string") {
    const key = v.trim().toLowerCase().replace(/[\s_-]/g, "");
    const direct = SNO_ALIASES[key];
    if (direct) return [direct];
    if (/^\d+$/.test(key)) return snoFromValue(Number(key));
    return [];
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Встречаются и битовая маска, и «номер» режима (0..5).
    const bits = SNO_BITS.filter(([bit]) => (v & bit) === bit).map(([, s]) => s);
    if (bits.length) return bits;
    return SNO_VALUES[v] ? [SNO_VALUES[v]] : [];
  }
  if (Array.isArray(v)) return v.flatMap((x) => snoFromValue(x));
  return [];
}

const SNO_KEYS = ["taxationtypes", "taxationtype", "taxsystems", "taxsystem", "snolist", "sno", "taxes"];

/** Ищем систему налогообложения по всему ответу кассы — ключи и форматы различаются. */
function collectSno(obj: any, depth = 0, out: KktSno[] = []): KktSno[] {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (SNO_KEYS.includes(k.toLowerCase().replace(/[\s_-]/g, ""))) {
      for (const s of snoFromValue(v)) if (!out.includes(s)) out.push(s);
    }
    if (v && typeof v === "object") collectSno(v, depth + 1, out);
  }
  return out;
}

/** Модель кассы, номер ФН и состояние смены — для кнопки «Проверить связь». */
export async function kktDeviceInfo(s: KktSettings): Promise<KktDeviceInfo> {
  const info: any = await runTask(s.url, { type: "getDeviceInfo" }, 12000).catch(async (e) => {
    if (e instanceof KktError && e.code === 404) return await driverFetch(s.url, "/api/v2/deviceInfo");
    throw e;
  });
  // Эти запросы поддерживают не все прошивки — молча пропускаем неудачные.
  // Таймаут короткий: неподдерживаемое задание иначе «висит» и опрос длится минуту.
  const opt = (type: string) => runTask(s.url, { type }, 4000).catch(() => null);
  const status: any = await opt("getDeviceStatus");
  const fn: any = await opt("getFnInfo");
  const reg: any = await opt("getRegistrationInfo");
  const shift: any = await opt("getShiftStatus");
  const all = [info, status, fn, reg, shift];
  const find = (keys: string[]) => {
    for (const src of all) {
      const v = deepFind(src, keys);
      if (v) return v;
    }
    return null;
  };
  const taxSystems = all.flatMap((src) => collectSno(src)).filter((v, i, a) => a.indexOf(v) === i);
  const suggestedSno = taxSystems[0] ?? null;
  // При ОСН почти всегда НДС 20%; при спецрежимах — «без НДС» (у плательщика УСН с НДС
  // ставку всё равно надо выбрать вручную, касса её не сообщает).
  const suggestedVat: KktVat | null = suggestedSno ? (suggestedSno === "osn" ? "vat20" : "none") : null;
  return {
    model: find(["modelName", "model", "deviceName", "modelDescription"]) ?? "—",
    serial: find(["serialNumber", "serial", "deviceSerial", "ecrSerial"]) ?? "—",
    fnNumber: find(["fnSerial", "fnNumber", "fnSerialNumber", "fiscalStorageNumber"]) ?? "—",
    regNumber: find(["regNumber", "ecrRegistrationNumber", "registrationNumber", "rnm"]) ?? "—",
    shiftState: parseShiftState(shift),
    shiftNumber: Number(find(["shiftNumber"]) ?? shift?.shiftStatus?.number ?? shift?.number ?? 0) || null,
    taxSystems,
    suggestedSno,
    suggestedVat,
    orgVatin: find(["vatin", "orgVatin", "inn", "orgInn"]),
  };
}



export function positionAmount(p: KktPosition): number {
  return p.amount != null ? round2(p.amount) : round2((Number(p.price) || 0) * (Number(p.quantity) || 0));
}

export function receiptTotal(positions: KktPosition[]): number {
  return round2(positions.reduce((s, p) => s + positionAmount(p), 0));
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Режим «услуги в стоимость товара»: суммы услуг распределяются по товарным
 * позициям пропорционально их стоимости, с округлением доли до рубля.
 * Остаток от округления добавляется к самой дорогой товарной позиции,
 * поэтому итог чека всегда совпадает с суммой накладной. Услуги в чек не идут.
 */
export function mergeServicesIntoGoods(positions: KktPosition[]): KktPosition[] {
  const live = positions.filter((p) => (Number(p.quantity) || 0) > 0);
  const goods = live.filter((p) => p.kind !== "service");
  const services = live.filter((p) => p.kind === "service");
  if (!services.length) return live;
  if (!goods.length) {
    throw new KktError("В накладной только услуги — включить их в стоимость товара нельзя.");
  }
  const serviceSum = round2(services.reduce((s, p) => s + positionAmount(p), 0));
  const goodsSum = round2(goods.reduce((s, p) => s + positionAmount(p), 0));
  const shares = goods.map((p) =>
    goodsSum > 0 ? Math.round((serviceSum * positionAmount(p)) / goodsSum) : 0,
  );
  // Остаток (в том числе копейки) — на позицию с наибольшей суммой.
  let biggest = 0;
  goods.forEach((p, i) => {
    if (positionAmount(p) > positionAmount(goods[biggest]!)) biggest = i;
  });
  const spread = round2(shares.reduce((s, v) => s + v, 0));
  shares[biggest] = round2((shares[biggest] ?? 0) + (serviceSum - spread));
  return goods.map((p, i) => {
    const amount = round2(positionAmount(p) + (shares[i] ?? 0));
    const quantity = Number(p.quantity) || 1;
    return { ...p, amount, price: round2(amount / quantity), quantity };
  });
}

/** Сборка задания «чек продажи» (или «чек возврата продажи») для драйвера ДТО10. */
export function buildSellReceipt(s: KktSettings, input: KktReceiptInput) {
  const items = input.positions
    .filter((p) => (Number(p.quantity) || 0) > 0)
    .map((p) => ({
      type: "position",
      name: String(p.name || "Товар").slice(0, 128),
      price: round2(p.price),
      quantity: Number(p.quantity) || 0,
      amount: positionAmount(p),
      measurementUnit: p.unit || "шт",
      paymentMethod: s.paymentMethod || KKT_DEFAULTS.paymentMethod,
      // Признак предмета расчёта — по каждой строке: услуга или товар (тег 1212).
      paymentObject:
        p.kind === "service" ? "service" : s.paymentObject || KKT_DEFAULTS.paymentObject,
      tax: { type: p.vat || s.vat || "none" },
    }));
  if (!items.length) throw new KktError("В документе нет позиций с количеством — чек пробить нельзя.");
  const total = round2(items.reduce((sum, i) => sum + i.amount, 0));
  // Наличными можно принять больше суммы чека — касса напечатает сдачу.
  const paid =
    input.paymentType === "cash" && input.cashReceived && input.cashReceived > total
      ? round2(input.cashReceived)
      : total;
  return {
    // В API веб-сервера ДТО10 операции называются sell / sellReturn.
    // sellReceipt / sellReturnReceipt не являются допустимыми типами заданий
    // и в некоторых версиях драйвера навсегда остаются в очереди.
    type: input.isReturn ? "sellReturn" : "sell",
    ignoreNonFiscalPrintErrors: false,
    taxationType: s.sno || KKT_DEFAULTS.sno,
    electronically: !!input.clientContact,
    ...(s.place ? { paymentsPlace: s.place } : {}),
    ...(input.clientContact ? { clientInfo: { emailOrPhone: input.clientContact } } : {}),
    operator: { name: s.cashier || "Кассир", ...(s.cashierVatin ? { vatin: s.cashierVatin } : {}) },
    items,
    payments: [{ type: input.paymentType, sum: paid }],
    total,
  };
}

/** Открыть смену на кассе. */
export async function kktOpenShift(s: KktSettings) {
  return runTask(
    s.url,
    {
      type: "openShift",
      operator: { name: s.cashier || "Кассир", ...(s.cashierVatin ? { vatin: s.cashierVatin } : {}) },
    },
    30000,
  );
}

/** Пробить чек продажи. Возвращает фискальные данные чека. */
export async function printSellReceipt(s: KktSettings, input: KktReceiptInput): Promise<KktFiscalResult> {
  const task = buildSellReceipt(s, input);
  // Смена должна быть открыта, иначе чек по закону пробить нельзя.
  // Если окно печати только что проверило смену и она открыта — не опрашиваем
  // кассу повторно: каждый лишний запрос к драйверу добавляет секунды ожидания.
  const state = input.knownShiftState ?? (await kktShiftState(s).catch(() => "unknown" as const));
  if (state === "expired") {
    throw new KktError("Смена открыта больше 24 часов — закройте смену на кассе, затем пробейте чек.");
  }
  if (state === "closed") await kktOpenShift(s);
  const res: any = await runTask(s.url, task);
  const doc = res?.fiscalParams ?? res ?? {};
  return {
    receiptNumber: Number(doc.receiptNumber ?? doc.documentNumber ?? 0) || null,
    shiftNumber: Number(doc.shiftNumber ?? 0) || null,
    fiscalDocNumber: Number(doc.fiscalDocumentNumber ?? doc.fnDocumentNumber ?? 0) || null,
    fiscalSign: doc.fiscalDocumentSign != null ? String(doc.fiscalDocumentSign) : null,
    fnNumber: doc.fnNumber ?? doc.fnSerial ?? null,
    regNumber: doc.registrationNumber ?? doc.regNumber ?? null,
    datetime: doc.dateTime ?? new Date().toISOString(),
    total: (task as any).total,
    operationId: input.operationId,
    isReturn: !!input.isReturn,
    paymentType: input.paymentType,
  };
}

/** Закрыть смену (печать Z-отчёта). */
export async function kktCloseShift(s: KktSettings) {
  return runTask(
    s.url,
    {
      type: "closeShift",
      operator: { name: s.cashier || "Кассир", ...(s.cashierVatin ? { vatin: s.cashierVatin } : {}) },
    },
    60000,
  );
}

/** Повторная печать копии последнего чека (если касса поддерживает). */
export async function printLastReceiptCopy(s: KktSettings) {
  return runTask(s.url, { type: "printLastReceiptCopy" }, 30000);
}

/** Ссылка на проверку чека в приложении ФНС. */
type FiscalLike = {
  fiscalDocNumber?: number | null;
  fiscalSign?: string | null;
  fnNumber?: string | null;
  total?: number;
  datetime?: string;
  isReturn?: boolean;
};

/**
 * Строка фискального QR-кода по приказу ФНС (тег 1196):
 * t=дата и время, s=сумма, fn=номер ФН, i=номер ФД, fp=фискальный признак,
 * n=признак расчёта (1 — приход, 2 — возврат прихода).
 */
export function fnsQrPayload(f: FiscalLike): string | null {
  if (!f.fiscalDocNumber || !f.fiscalSign || !f.fnNumber) return null;
  const dt = f.datetime ? new Date(f.datetime) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const t = `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}`;
  const s = (Number(f.total) || 0).toFixed(2);
  return `t=${t}&s=${s}&fn=${f.fnNumber}&i=${f.fiscalDocNumber}&fp=${f.fiscalSign}&n=${f.isReturn ? 2 : 1}`;
}

/** Ссылка на проверку чека в сервисе ФНС. */
export function fnsCheckUrl(f: FiscalLike) {
  const qr = fnsQrPayload(f);
  return qr ? `https://consumer.nalog.ru/check?${qr}` : null;
}
