import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { db } from "@/integrations/db";
import { buildDocTree, docAmount, docStatusLabel, docTitle, type DocNode } from "@/lib/doc-tree";
import { CornerDownRight } from "lucide-react";

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const dfmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

const SELECT = "id,number,doc_type,kind,issue_date,total,status,cash_received,is_return,parent_id";

/** Загружает всю цепочку документов: вверх до самого первого и вниз по всем подчинённым. */
async function loadChain(docId: string): Promise<{ docs: DocNode[]; rootId: string }> {
  const all = new Map<string, DocNode>();

  const fetchByIds = async (ids: string[]) => {
    if (!ids.length) return [] as DocNode[];
    const { data } = await (db as any).from("invoices").select(SELECT).in("id", ids);
    return (data ?? []) as DocNode[];
  };
  const fetchChildren = async (ids: string[]) => {
    if (!ids.length) return [] as DocNode[];
    const { data } = await (db as any).from("invoices").select(SELECT).in("parent_id", ids);
    return (data ?? []) as DocNode[];
  };

  // вверх до корня
  let current = (await fetchByIds([docId]))[0];
  if (!current) return { docs: [], rootId: docId };
  all.set(current.id, current);
  let guard = 0;
  while (current?.parent_id && guard++ < 20) {
    const parent = (await fetchByIds([current.parent_id]))[0];
    if (!parent || all.has(parent.id)) break;
    all.set(parent.id, parent);
    current = parent;
  }
  const rootId = current.id;

  // вниз по всем уровням
  let frontier = [rootId];
  let depth = 0;
  while (frontier.length && depth++ < 20) {
    const kids = await fetchChildren(frontier);
    const fresh = kids.filter((k) => !all.has(k.id));
    for (const k of fresh) all.set(k.id, k);
    frontier = fresh.map((k) => k.id);
  }

  return { docs: [...all.values()], rootId };
}

export function DocTreeCard({
  docId,
  actions,
  hint,
}: {
  docId: string;
  actions?: React.ReactNode;
  hint?: string;
}) {
  const { data } = useQuery({
    queryKey: ["doc-chain", docId],
    queryFn: () => loadChain(docId),
  });

  const rows = data ? buildDocTree(data.docs, data.rootId) : [];
  const single = rows.length <= 1;

  return (
    <Card className="p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-medium">Цепочка документов</h3>
        {actions}
      </div>
      {single ? (
        <p className="text-sm text-muted-foreground">
          {hint ?? "Связанных документов пока нет."}
        </p>
      ) : (
        <div className="divide-y">
          {rows.map(({ doc, depth }) => {
            const isCurrent = doc.id === docId;
            return (
              <div
                key={doc.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${isCurrent ? "bg-muted/60 rounded-md px-2" : ""}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: depth * 18 }}>
                  {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="shrink-0 text-muted-foreground">{docTitle(doc.doc_type, doc.kind, doc.is_return)}</span>
                  {isCurrent ? (
                    <span className="truncate font-medium">№ {doc.number}</span>
                  ) : (
                    <Link
                      to="/invoices/$id"
                      params={{ id: doc.id }}
                      className="truncate text-primary hover:underline"
                    >
                      № {doc.number}
                    </Link>
                  )}
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {doc.issue_date ? dfmt.format(new Date(doc.issue_date)) : "—"}
                </span>
                <span className="w-24 shrink-0 text-muted-foreground">{docStatusLabel(doc)}</span>
                <span className="shrink-0 tabular-nums">{fmt.format(docAmount(doc))}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
