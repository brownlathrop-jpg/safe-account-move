// Сумма прописью (рубли и копейки), RU
const ones = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const onesF = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function plural(n: number, forms: [string, string, string]) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

function tripletToWords(n: number, fem: boolean): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const u = rest % 10;
  if (h) out.push(hundreds[h]);
  if (rest < 20) {
    if (rest) out.push(fem ? onesF[rest] : ones[rest]);
  } else {
    out.push(tens[t]);
    if (u) out.push(fem ? onesF[u] : ones[u]);
  }
  return out.join(" ");
}

export function amountInWords(amount: number): string {
  const rub = Math.floor(amount);
  const kop = Math.round((amount - rub) * 100);
  const parts: string[] = [];
  const billions = Math.floor(rub / 1_000_000_000);
  const millions = Math.floor((rub % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((rub % 1_000_000) / 1000);
  const units = rub % 1000;

  if (billions) parts.push(tripletToWords(billions, false), plural(billions, ["миллиард", "миллиарда", "миллиардов"]));
  if (millions) parts.push(tripletToWords(millions, false), plural(millions, ["миллион", "миллиона", "миллионов"]));
  if (thousands) parts.push(tripletToWords(thousands, true), plural(thousands, ["тысяча", "тысячи", "тысяч"]));
  if (units || parts.length === 0) parts.push(tripletToWords(units || 0, false));
  parts.push(plural(rub, ["рубль", "рубля", "рублей"]));

  let words = parts.filter(Boolean).join(" ").trim();
  words = words.charAt(0).toUpperCase() + words.slice(1);
  const kopStr = String(kop).padStart(2, "0");
  words += ` ${kopStr} ${plural(kop, ["копейка", "копейки", "копеек"])}`;
  return words;
}
