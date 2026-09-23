// Акт сверки взаиморасчётов с контрагентом: сальдо на начало, операции
// за период, обороты и сальдо на конец с печатной формой для подписей.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PartnerPicker } from "@/components/PartnerPicker";
import { Download, Printer, Scale } from "lucide-react";
import { downloadCsv } from "@/lib/export-csv";
import { useOrganizations, useMyOrgId, pickOrg } from "@/lib/organizations";
import { useViewLog } from "@/hooks/use-view-log";
import {
  buildReconciliation, balanceNote, printReconciliation, ruDate,
  type ReconDoc, type ReconPay,
} from "@/lib/reconciliation";

export const Route = createFileRoute("/_authenticated/reports/reconciliation")({
  head: () => ({
    meta: [
      { title: "Акт сверки взаиморасчётов — КабинетCRM" },
      { name: "description", content: "Акт сверки с контрагентом: сальдо на начало и конец периода, отгрузки, поступления и оплаты." },
      { property: "og:title", content: "Акт сверки взаиморасчётов — КабинетCRM" },
      { property: "og:description", content: "Сверка расчётов с контрагентом за период с печатной формой для подписей сторон." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    partner: typeof s.partner === "string" ? s.partner : undefined,
  }),
  component: ReconciliationPage,
});

const fmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ReconciliationPage() {
  useViewLog("reports");
  const wsId = useActiveWorkspaceId();
  const { partner: partnerFromUrl } = Route.useSearch();

  // Фильтры сохраняются между переходами по меню
  const [partnerId, setPartnerId] = usePersistentState<string>("recon.partner", partnerFromUrl ?? "");
  const [from, setFrom] = usePersistentState<string>("recon.from", yearStart());
  const [to, setTo] = usePersistentState<string>("recon.to", today());

  const { data: orgs = [] } = useOrganizations(wsId);
  const { data: myOrgId } = useMyOrgId(wsId);
  const [orgSel, setOrgSel] = usePersistentState<string>("recon.org", "");

  // Переход из карточки контрагента (параметр в ссылке) важнее сохранённого выбора
  useEffect(() => {
    if (partnerFromUrl) setPartnerId(partnerFromUrl);
  }, [partnerFromUrl, setPartnerId]);
  const org = pickOrg(orgs, orgSel || myOrgId || null) as any;
  const effOrgId: string | null = org?.id ?? null;

  const { data: partner } = useQuery({
    queryKey: ["partner", partnerId],
    enabled: !!partnerId,
    queryFn: async () =>
      (await (db as any).from("partners").select("id,name,inn").eq("id", partnerId).maybeSingle()).data,
  });

  const { data: docs = [], isLoading: docsLoading } = useQuery<ReconDoc[]>({
    queryKey: ["recon-docs", wsId, partnerId],
    enabled: !!wsId && !!partnerId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("invoices")
        .select("id,number,issue_date,doc_type,kind,is_return,total,status,organization_id")
        .eq("workspace_id", wsId)
        .eq("partner_id", partnerId);
      if (error) throw error;
      return (data ?? []) as ReconDoc[];
    },
  });

  const { data: pays = [] } = useQuery<ReconPay[]>({
    queryKey: ["recon-pays", wsId, partnerId],
    enabled: !!wsId && !!partnerId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("invoice_payments")
        .select("id,invoice_id,amount,date,direction,method,note")
        .eq("workspace_id", wsId)
        .eq("partner_id", partnerId);
      if (error) throw error;
      return (data ?? []) as ReconPay[];
    },
  });

  const recon = useMemo(
    () => buildReconciliation(docs, pays, { from, to, orgId: effOrgId }),
    [docs, pays, from, to, effOrgId],
  );

  const orgName = org?.print_name?.trim() || org?.name || "Наша организация";
  const partnerName = partner?.name || "Контрагент";

  const exportExcel = () =>
    downloadCsv("акт-сверки", recon.rows, [
      { header: "Дата", value: (r) => ruDate(r.date) },
      { header: "Документ, операция", value: (r) => r.title },
      { header: "Дебет", value: (r) => r.debit || "" },
      { header: "Кредит", value: (r) => r.credit || "" },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 p-2">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Акт сверки взаиморасчётов</h1>
          <p className="text-sm text-muted-foreground">
            Сальдо на начало, отгрузки, поступления и оплаты за период, обороты и сальдо на конец.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={exportExcel} disabled={!recon.rows.length}>
            <Download className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button
            disabled={!partnerId}
            onClick={() => printReconciliation(recon, org, partner ?? null, { from, to })}
          >
            <Printer className="h-4 w-4 mr-1" /> Печать акта
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Контрагент</Label>
            <PartnerPicker value={partnerId || null} onChange={setPartnerId} kind="all" />
          </div>
          {orgs.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Организация</Label>
              <Select value={orgSel || org?.id || ""} onValueChange={setOrgSel}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orgs.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">С даты</Label>
              <Input className="h-8" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">По дату</Label>
              <Input className="h-8" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      {!partnerId ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Выберите контрагента — и акт сверки соберётся за выбранный период.
        </Card>
      ) : docsLoading ? (
        <div className="text-muted-foreground">Загрузка…</div>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Дата</TableHead>
                  <TableHead>Документ, операция</TableHead>
                  <TableHead className="text-right w-36">Дебет (долг нам)</TableHead>
                  <TableHead className="text-right w-36">Кредит (наш долг)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-medium bg-muted/40">
                  <TableCell>{ruDate(from)}</TableCell>
                  <TableCell>Сальдо на начало периода</TableCell>
                  <TableCell className="text-right">{recon.opening > 0 ? fmt.format(recon.opening) : ""}</TableCell>
                  <TableCell className="text-right">{recon.opening < 0 ? fmt.format(-recon.opening) : ""}</TableCell>
                </TableRow>
                {recon.rows.map((r, i) => (
                  <TableRow key={`${r.date}-${i}`}>
                    <TableCell>{ruDate(r.date)}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-right">{r.debit ? fmt.format(r.debit) : ""}</TableCell>
                    <TableCell className="text-right">{r.credit ? fmt.format(r.credit) : ""}</TableCell>
                  </TableRow>
                ))}
                {!recon.rows.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      За выбранный период операций нет.
                    </TableCell>
                  </TableRow>
                )}
                <TableRow className="font-medium bg-muted/40">
                  <TableCell />
                  <TableCell>Обороты за период</TableCell>
                  <TableCell className="text-right">{fmt.format(recon.debit)}</TableCell>
                  <TableCell className="text-right">{fmt.format(recon.credit)}</TableCell>
                </TableRow>
                <TableRow className="font-semibold bg-muted/60">
                  <TableCell>{ruDate(to)}</TableCell>
                  <TableCell>Сальдо на конец периода</TableCell>
                  <TableCell className="text-right">{recon.closing > 0 ? fmt.format(recon.closing) : ""}</TableCell>
                  <TableCell className="text-right">{recon.closing < 0 ? fmt.format(-recon.closing) : ""}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4 text-sm font-medium">{balanceNote(recon.closing, orgName, partnerName)}</Card>
        </>
      )}
    </div>
  );
}
