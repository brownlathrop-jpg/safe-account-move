import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import type { PrintBrand } from "@/lib/print-header";

/** Логотип, название и реквизиты организации для шапки печатных документов. */
export function usePrintBrand(): PrintBrand | null {
  const wsId = useActiveWorkspaceId();
  const { data } = useQuery({
    queryKey: ["print-brand", wsId],
    enabled: !!wsId,
    staleTime: 60_000,
    queryFn: async () =>
      (await (db as any)
        .from("organizations")
        .select("*")
        .eq("workspace_id", wsId)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle()).data,
  });
  return (data ?? null) as PrintBrand | null;
}
