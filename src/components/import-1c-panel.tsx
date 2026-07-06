import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileWarning } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { importAll } from "@/lib/import-1c";
import { useQueryClient } from "@tanstack/react-query";

export function Import1CPanel() {
  const wsId = useActiveWorkspaceId();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Нет сессии"); return; }
    setBusy(true); setError(null); setLog([]);
    try {
      const xml = await file.text();
      await importAll(xml, wsId, user.id, (s, d, t, n) => {
        setStage(s); setDone(d); setTotal(t); setNote(n || "");
        setLog(prev => (prev[prev.length - 1]?.startsWith(s) ? [...prev.slice(0, -1), `${s}: ${d}/${t}${n ? " — " + n : ""}`] : [...prev, `${s}: ${d}/${t}${n ? " — " + n : ""}`]));
      });
      toast.success("Импорт справочников завершён");
      qc.invalidateQueries();
    } catch (e: any) {
      setError(e?.message || String(e));
      toast.error("Ошибка импорта");
    } finally {
      setBusy(false);
    }
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-medium">Импорт из 1С</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Загрузите файл <code>export.xml</code> — выгрузку из 1С «Управление торговлей» (правила КонвертацииДанных 2.0).
          На этом шаге переносятся: <b>склады, виды номенклатуры, типы цен, статьи ДДС, банки, банковские счета, контрагенты, папки товаров и товары</b>.
          Документы (реализация, поступление, ПКО/РКО) — будут отдельным шагом.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="file" accept=".xml,application/xml" hidden disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <Button asChild disabled={busy}><span><Upload className="h-4 w-4 mr-1" />{busy ? "Импортирую…" : "Выбрать файл XML"}</span></Button>
        </label>
        {busy && <span className="text-sm text-muted-foreground">{stage}: {done}/{total} {note && `— ${note}`}</span>}
      </div>

      {busy && (
        <div className="space-y-2">
          <Progress value={pct} />
          <p className="text-xs text-muted-foreground">Не закрывайте вкладку — обработка идёт в браузере.</p>
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive flex items-start gap-2">
          <FileWarning className="h-4 w-4 mt-0.5" />
          <div><b>Ошибка:</b> {error}</div>
        </div>
      )}

      {log.length > 0 && (
        <div className="border rounded p-3 bg-muted/30 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </Card>
  );
}
