import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { db } from "@/integrations/db";
import { buildDocTree, docAmount, docStatusLabel, docTitle, type DocNode } from "@/lib/doc-tree";
import { ChevronRight, FileText } from "lucide-react";

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
    <section className="overflow-hidden rounded-lg border bg-card print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
        <h3 className="font-display text-sm font-semibold">Документы</h3>
        {actions}
      </div>
      {single ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {hint ?? "Связанных документов пока нет."}
        </p>
      ) : (
        <div className="overflow-x-auto px-4 py-3">
          <div className="flex min-w-max items-stretch">
          {rows.map(({ doc }, index) => {
            const isCurrent = doc.id === docId;
            return (
              <div key={doc.id} className="flex items-center">
                {index > 0 && <ChevronRight className="mx-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <Link
                  to="/invoices/$id"
                  params={{ id: doc.id }}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`group flex min-w-52 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent ${isCurrent ? "border-primary/40 bg-accent" : "bg-background"}`}
                >
                  <FileText className={`h-4 w-4 shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {docTitle(doc.doc_type, doc.kind, doc.is_return)} № {doc.number}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                      <span>{doc.issue_date ? dfmt.format(new Date(doc.issue_date)) : "—"}</span>
                      {docStatusLabel(doc) !== "—" && <span>{docStatusLabel(doc)}</span>}
                      <span className="tabular-nums">{fmt.format(docAmount(doc))}</span>
                    </span>
                  </span>
                </Link>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}
