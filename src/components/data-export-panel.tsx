import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { backupExport } from "@/lib/backup.functions";
import { useActiveWorkspaceId } from "@/lib/workspace";

/** Ручная выгрузка всех данных базы одним файлом. */
export function DataExportPanel() {
  const wsId = useActiveWorkspaceId();
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  async function run() {
    if (!wsId) return;
    setBusy(true);
    try {
      const res: any = await backupExport({ data: { workspaceId: wsId } });
      if (res.error || !res.data) throw new Error(res.error?.message ?? "Не удалось выгрузить данные");
      const dump = res.data;
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `выгрузка-базы-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setCounts(dump.counts);
      toast.success("Файл с данными сохранён");
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-medium">Выгрузка всех данных</h2>
        <p className="text-sm text-muted-foreground">
          Один файл со всеми товарами, контрагентами, документами, оплатами и движениями склада этой базы.
          Резервные копии сервера при этом делаются каждую ночь автоматически.
        </p>
      </div>
      <Button onClick={run} disabled={busy || !wsId}>
        {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
        Выгрузить все данные
      </Button>
      {counts && (
        <div className="text-sm text-muted-foreground">
          Записей в файле: <b>{total}</b> — товаров {counts["products"] ?? 0}, контрагентов {counts["partners"] ?? 0},
          документов {counts["invoices"] ?? 0}, позиций {counts["invoice_items"] ?? 0}.
        </div>
      )}
    </Card>
  );
}
