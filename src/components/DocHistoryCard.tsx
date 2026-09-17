import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { teamDocHistory } from "@/lib/team.functions";

const OP_LABEL: Record<string, string> = {
  insert: "создан",
  update: "изменён",
  delete: "удалён",
};

/** История изменений документа: кто и когда менял. */
export function DocHistoryCard({ table, docId }: { table: string; docId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["doc-history", table, docId],
    queryFn: async () => {
      const res = await teamDocHistory({ data: { table, docId } });
      if (res.error) throw new Error(res.error.message);
      return (res.data ?? []) as any[];
    },
  });

  if (!data.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">История изменений</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y text-sm">
          {data.map((h) => (
            <div key={h.id} className="flex flex-wrap gap-x-2 py-1.5">
              <span className="text-muted-foreground">
                {new Date(h.created_at).toLocaleString("ru-RU")}
              </span>
              <span className="font-medium">{h.user_email || "—"}</span>
              <span>{OP_LABEL[h.op] ?? h.op}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
