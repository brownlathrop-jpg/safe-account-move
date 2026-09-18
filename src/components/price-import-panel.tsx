// Загрузка прайсов и остатков из Excel/CSV + выгрузка товаров в 1С и в прайс.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Loader2, FileWarning, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { usePriceTypes } from "@/lib/price-types";
import {
  applyPriceChanges,
  buildPricePreview,
  parsePriceFile,
  type PricePreview,
  type PriceRow,
} from "@/lib/price-import";
import { buildCommerceMl, buildPriceCsv, downloadText, loadExportData } from "@/lib/export-1c";

export function PriceImportPanel() {
  const wsId = useActiveWorkspaceId();
  const qc = useQueryClient();
  const { data: priceTypes = [] } = usePriceTypes(wsId);
  const baseTypeId = priceTypes.find(t => t.is_default)?.id ?? priceTypes[0]?.id ?? null;

  const [priceTypeId, setPriceTypeId] = useState<string>("");
  const [updatePrices, setUpdatePrices] = useState(true);
  const [updateCost, setUpdateCost] = useState(true);
  const [updateStock, setUpdateStock] = useState(false);

  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(0);
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef<PriceRow[]>([]);

  const selectedType = priceTypeId || baseTypeId || "";

  const onFile = async (file: File) => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    setBusy(true); setError(null); setPreview(null); setApplied(0);
    try {
      const text = await file.text();
      const { rows, usedColumns } = parsePriceFile(text, priceTypes);
      if (!rows.length) throw new Error("В файле не найдено строк с товарами. Проверьте, что первая строка — заголовки.");
      rowsRef.current = rows;
      const pv = await buildPricePreview(
        rows, wsId,
        { updatePrices, updateCost, updateStock, priceTypeId: selectedType || null, baseTypeId },
        usedColumns,
      );
      setPreview(pv);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const recalc = async () => {
    if (!wsId || !rowsRef.current.length) return;
    setBusy(true);
    try {
      const pv = await buildPricePreview(
        rowsRef.current, wsId,
        { updatePrices, updateCost, updateStock, priceTypeId: selectedType || null, baseTypeId },
        preview?.usedColumns ?? [],
      );
      setPreview(pv);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview?.changes.length) return;
    setBusy(true); setError(null);
    try {
      await applyPriceChanges(preview.changes, done => setApplied(done));
      toast.success(`Обновлено товаров: ${preview.changes.length}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      setPreview(null);
      rowsRef.current = [];
    } catch (e: any) {
      setError(e?.message || String(e));
      toast.error("Не удалось применить прайс");
    } finally {
      setBusy(false);
    }
  };

  const exportXml = async () => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    setBusy(true);
    try {
      const { products, folders } = await loadExportData(wsId);
      const xml = buildCommerceMl(products, folders, priceTypes, "КабинетCRM");
      downloadText(`import-1c-${new Date().toISOString().slice(0, 10)}.xml`, xml, "application/xml");
      toast.success(`Выгружено товаров: ${products.length}`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка выгрузки");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (!wsId) { toast.error("Не выбрана база данных"); return; }
    setBusy(true);
    try {
      const { products } = await loadExportData(wsId);
      downloadText(`price-${new Date().toISOString().slice(0, 10)}.csv`, buildPriceCsv(products, priceTypes), "text/csv");
      toast.success(`Выгружено товаров: ${products.length}`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка выгрузки");
    } finally {
      setBusy(false);
    }
  };

  const pct = preview?.changes.length ? Math.round((applied / preview.changes.length) * 100) : 0;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-medium">Прайсы и остатки (Excel/CSV)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Загрузите файл, где первая строка — заголовки колонок. Распознаются: <b>Наименование</b>, <b>Артикул</b>,
          <b> Код 1С</b>, <b>Цена</b>, <b>Закуп</b>, <b>Остаток</b>, а также колонки с названиями ваших типов цен.
          Товары ищутся по артикулу, коду 1С и названию — новые не создаются.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Колонка «Цена» — это тип цены</Label>
          <Select value={selectedType} onValueChange={v => { setPriceTypeId(v); }}>
            <SelectTrigger><SelectValue placeholder="Выберите тип цены" /></SelectTrigger>
            <SelectContent>
              {priceTypes.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}{t.is_default ? " (основной)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:pt-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={updatePrices} onCheckedChange={setUpdatePrices} /> Обновлять цены
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={updateCost} onCheckedChange={setUpdateCost} /> Обновлять закупочную цену
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={updateStock} onCheckedChange={setUpdateStock} /> Обновлять остатки
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer">
          <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <Button asChild disabled={busy}><span>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Выбрать файл прайса
          </span></Button>
        </label>
        <Button variant="secondary" onClick={exportXml} disabled={busy}>
          <Download className="h-4 w-4 mr-1" /> Выгрузить в 1С (XML)
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={busy}>
          <Download className="h-4 w-4 mr-1" /> Выгрузить прайс (Excel)
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive flex items-start gap-2">
          <FileWarning className="h-4 w-4 mt-0.5" /><div><b>Ошибка:</b> {error}</div>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-md border p-3 bg-muted/30">
          <div className="text-sm">
            Строк в файле: <b>{preview.rows}</b> · будет изменено товаров: <b>{preview.changes.length}</b> ·
            без изменений: <b>{preview.unchanged}</b> · не найдено в базе: <b>{preview.notFound.length}</b>
          </div>
          {preview.usedColumns.length > 0 && (
            <div className="text-xs text-muted-foreground">Распознанные колонки: {preview.usedColumns.join(", ")}</div>
          )}
          {preview.changes.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded border bg-background p-2 text-xs font-mono space-y-0.5">
              {preview.changes.slice(0, 200).map(c => (
                <div key={c.productId}>
                  {c.productName}
                  {c.patch.price != null ? ` · цена ${c.before.price} → ${c.patch.price}` : ""}
                  {c.patch.cost != null ? ` · закуп ${c.before.cost} → ${c.patch.cost}` : ""}
                  {c.patch.stock != null ? ` · остаток ${c.before.stock} → ${c.patch.stock}` : ""}
                  {c.patch.prices && c.patch.price == null ? " · цены по типам" : ""}
                </div>
              ))}
              {preview.changes.length > 200 && <div>… и ещё {preview.changes.length - 200}</div>}
            </div>
          )}
          {preview.notFound.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Не найдено: {preview.notFound.slice(0, 15).join(", ")}
              {preview.notFound.length > 15 ? ` … и ещё ${preview.notFound.length - 15}` : ""}
            </div>
          )}
          {busy && applied > 0 && <Progress value={pct} />}
          <div className="flex gap-2">
            <Button onClick={apply} disabled={busy || !preview.changes.length}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Применить к {preview.changes.length} товарам
            </Button>
            <Button variant="outline" onClick={recalc} disabled={busy}>Пересчитать</Button>
            <Button variant="ghost" onClick={() => { setPreview(null); rowsRef.current = []; }} disabled={busy}>Отмена</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
