/**
 * Иерархия документов: заявка → накладная / поступление → ПКО / РКО.
 * Здесь только названия документов и сборка дерева по parent_id.
 */

export type DocKind = "outgoing" | "incoming";
export type DocTypeName = "order" | "shipment" | "cash_receipt";

export type DocNode = {
  id: string;
  number: string;
  doc_type: string;
  kind?: DocKind | string | null;
  issue_date?: string | null;
  status?: string | null;
  total?: number | string | null;
  cash_received?: number | string | null;
  is_return?: boolean | null;
  parent_id?: string | null;
};

/** Для кассовых ордеров вид документа определяется по префиксу номера,
 *  чтобы не было рассогласования «номер ПКО, а в интерфейсе РКО». */
export function effectiveCashKind(
  docType: string | null | undefined,
  kind: string | null | undefined,
  number: string | null | undefined,
): "incoming" | "outgoing" | null {
  if (docType !== "cash_receipt") return null;
  const n = (number ?? "").toUpperCase();
  if (n.startsWith("ПКО")) return "incoming";
  if (n.startsWith("РКО")) return "outgoing";
  if (kind === "incoming" || kind === "outgoing") return kind;
  return null;
}

/** Человеческое название документа с учётом вида (приход/расход) и возврата. */
export function docTitle(
  docType: string | null | undefined,
  kind: string | null | undefined,
  isReturn?: boolean | null,
  number?: string | null | undefined,
): string {
  const incoming = (effectiveCashKind(docType, kind, number) ?? kind) === "incoming";
  if (docType === "cash_receipt") return incoming ? "ПКО" : "РКО";
  if (docType === "shipment") {
    if (isReturn) return incoming ? "Возврат от покупателя" : "Возврат поставщику";
    return incoming ? "Поступление товара" : "Расходная накладная";
  }
  if (docType === "order") return incoming ? "Заявка поставщику" : "Заявка покупателя";
  return "Документ";
}

/** Название в винительном падеже: «отменить <…>». */
export function docTitleAccusative(
  docType: string | null | undefined,
  kind: string | null | undefined,
  number?: string | null | undefined,
): string {
  const incoming = (effectiveCashKind(docType, kind, number) ?? kind) === "incoming";
  if (docType === "cash_receipt") return incoming ? "ПКО" : "РКО";
  if (docType === "shipment") return incoming ? "поступление" : "накладную";
  if (docType === "order") return "заявку";
  return "документ";
}

/** Сумма документа для списка: у кассовых — полученная сумма. */
export function docAmount(d: DocNode): number {
  return Number(d.doc_type === "cash_receipt" ? (d.cash_received ?? 0) : (d.total ?? 0));
}

export function docStatusLabel(d: DocNode): string {
  if (d.doc_type !== "shipment") return "—";
  if (d.status === "posted") return "Проведён";
  if (d.status === "cancelled") return "Отменён";
  return "Черновик";
}

export type TreeRow = { doc: DocNode; depth: number };

/** Плоский список документов → отсортированные строки дерева с отступами. */
export function buildDocTree(docs: DocNode[], rootId: string): TreeRow[] {
  const byParent = new Map<string | null, DocNode[]>();
  for (const d of docs) {
    const key = d.parent_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(d);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => String(a.issue_date ?? "").localeCompare(String(b.issue_date ?? "")));
  }
  const root = docs.find((d) => d.id === rootId);
  if (!root) return [];
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (node: DocNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    rows.push({ doc: node, depth });
    for (const child of byParent.get(node.id) ?? []) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}
