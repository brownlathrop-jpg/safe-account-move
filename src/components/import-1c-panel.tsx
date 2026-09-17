import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileWarning, Loader2, CheckCircle2, Download } from "lucide-react";
import { db } from "@/integrations/firebase/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { importAll } from "@/lib/import-1c";
import { importProductsCsv } from "@/lib/import-1c-csv";
import { useQueryClient } from "@tanstack/react-query";

export function Import1CPanel() {
  const wsId = useActiveWorkspaceId();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [log, setLog] = useState<{ stage: string; done: number; total: number; note: string; finished: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [busy]);

  const onFile = async (file: File) => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    const { data: { user } } = await db.auth.getUser();
    if (!user) { toast.error("Нет сессии"); return; }
    setBusy(true); setError(null); setLog([]); setStage(""); setDone(0); setTotal(0); setNote("");
    startedAtRef.current = Date.now(); setElapsed(0);
    try {
      const xml = await file.text();
      await importAll(xml, wsId, user.id, (s, d, t, n) => {
        setStage(s); setDone(d); setTotal(t); setNote(n || "");
        setLog(prev => {
          const entry = { stage: s, done: d, total: t, note: n || "", finished: t > 0 && d >= t };
          const last = prev[prev.length - 1];
          if (last && last.stage === s) return [...prev.slice(0, -1), entry];
          // помечаем предыдущий этап завершённым
          const withPrevDone = last ? [...prev.slice(0, -1), { ...last, finished: true }] : [];
          return [...withPrevDone, entry];
        });
      });
      setLog(prev => prev.map((l, i) => i === prev.length - 1 ? { ...l, finished: true } : l));
      toast.success("Импорт справочников завершён");
      qc.invalidateQueries();
    } catch (e: any) {
      setError(e?.message || String(e));
      toast.error("Ошибка импорта");
    } finally {
      setBusy(false);
    }
  };

  const onCsv = async (file: File) => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    const { data: { user } } = await db.auth.getUser();
    if (!user) { toast.error("Нет сессии"); return; }
    setBusy(true); setError(null); setLog([]); setStage(""); setDone(0); setTotal(0); setNote("");
    startedAtRef.current = Date.now(); setElapsed(0);
    try {
      const text = await file.text();
      await importProductsCsv(text, wsId, user.id, (s, d, t, n) => {
        setStage(s); setDone(d); setTotal(t); setNote(n || "");
        setLog(prev => {
          const entry = { stage: s, done: d, total: t, note: n || "", finished: t > 0 && d >= t };
          const last = prev[prev.length - 1];
          if (last && last.stage === s) return [...prev.slice(0, -1), entry];
          const withPrevDone = last ? [...prev.slice(0, -1), { ...last, finished: true }] : [];
          return [...withPrevDone, entry];
        });
      });
      setLog(prev => prev.map((l, i) => i === prev.length - 1 ? { ...l, finished: true } : l));
      toast.success("CSV импортирован");
      qc.invalidateQueries();
    } catch (e: any) {
      setError(e?.message || String(e));
      toast.error("Ошибка импорта CSV");
    } finally {
      setBusy(false);
    }
  };

  const downloadDiag = () => {
    const diag = (window as any).__importDiag;
    const diagDocs = (window as any).__importDiagDocs;
    if (!diag && !diagDocs) { toast.error("Диагностика ещё не сформирована. Сначала запустите импорт."); return; }
    const payload = { папки: diag ?? null, документы: diagDocs ?? null };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-diag-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

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
          <Button asChild disabled={busy}><span>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {busy ? "Импортирую…" : "Выбрать файл XML"}
          </span></Button>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="file" accept=".csv,text/csv" hidden disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ""; }} />
          <Button asChild disabled={busy} variant="secondary"><span>
            <Upload className="h-4 w-4 mr-1" />
            Догрузить product.csv
          </span></Button>
        </label>
        {!busy && log.length > 0 && (
          <Button variant="outline" onClick={downloadDiag} title="Сохранить отчёт о папках без родителя">
            <Download className="h-4 w-4 mr-1" /> Скачать диагностику
          </Button>
        )}
      </div>

      {busy && (
        <div className="space-y-2 rounded-md border bg-primary/5 p-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Идёт импорт: {stage || "подготовка…"}
            </div>
            <div className="tabular-nums text-muted-foreground">
              {done}/{total} · {pct}% · {fmtTime(elapsed)}
            </div>
          </div>
          <Progress value={pct} />
          {note && <div className="text-xs text-muted-foreground">{note}</div>}
          <p className="text-xs text-muted-foreground">Не закрывайте вкладку — обработка идёт в браузере.</p>
        </div>
      )}

      {!busy && log.length > 0 && !error && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Импорт завершён за {fmtTime(elapsed)}
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
          {log.map((l, i) => {
            const isCurrent = busy && i === log.length - 1 && !l.finished;
            const icon = isCurrent ? "⏳" : l.finished ? "✓" : "•";
            return (
              <div key={i} className={isCurrent ? "text-foreground" : l.finished ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {icon} {l.stage}: {l.done}/{l.total}{l.note ? ` — ${l.note}` : ""}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
