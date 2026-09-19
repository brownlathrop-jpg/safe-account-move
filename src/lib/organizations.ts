// Список организаций (юрлиц) базы данных: из одной базы можно торговать
// под разными юрлицами — товары, склады и контрагенты общие, а реквизиты,
// нумерация, касса и налоговый учёт у каждой организации свои.
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db";

export type OrgRecord = {
  id: string;
  name: string;
  is_primary?: boolean;
  invoice_number_mask?: string;
  invoice_number_start?: number;
  // Своя онлайн-касса организации (если включена — чеки бьются с этими реквизитами)
  kkt_enabled?: boolean;
  kkt_sno?: string;
  kkt_vat?: string;
  kkt_payment_method?: string;
  kkt_payment_object?: string;
  kkt_cashier?: string;
  kkt_cashier_vatin?: string;
  kkt_place?: string;
  [k: string]: any;
};

export function useOrganizations(wsId: string | null | undefined) {
  return useQuery({
    queryKey: ["organizations", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("organizations")
        .select("*")
        .eq("workspace_id", wsId)
        .order("is_primary", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as OrgRecord[];
    },
  });
}

/** Организация по id, иначе основная, иначе первая. */
export function pickOrg(orgs: OrgRecord[], id?: string | null): OrgRecord | null {
  return orgs.find((o) => o.id === id) ?? orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
}

/**
 * Организация, от которой работает текущий вход (как в BigBird — у каждого
 * логина своё юрлицо). Источник: привязка участника базы (её задаёт владелец
 * в разделе «Сотрудники»), иначе личный выбор пользователя в настройках.
 */
export function useMyOrgId(wsId: string | null | undefined) {
  return useQuery({
    queryKey: ["my-org", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data: { user } } = await db.auth.getUser();
      if (user) {
        const { data: m } = await (db as any)
          .from("workspace_members").select("*")
          .eq("workspace_id", wsId).eq("user_id", user.id).maybeSingle();
        if (m?.organization_id) return m.organization_id as string;
      }
      const { userPrefsGet } = await import("@/lib/db.functions");
      const prefs = (await userPrefsGet()).prefs ?? {};
      return ((prefs as any)?.default_org?.[wsId!] ?? null) as string | null;
    },
  });
}

/** Сохранить личную организацию по умолчанию (для владельца базы). */
export async function setMyOrgPref(wsId: string, orgId: string | null) {
  const { userPrefsGet, userPrefsSet } = await import("@/lib/db.functions");
  const prefs = (await userPrefsGet()).prefs ?? {};
  const map = { ...((prefs as any).default_org ?? {}) };
  if (orgId) map[wsId] = orgId; else delete map[wsId];
  await userPrefsSet({ data: { patch: { default_org: map } } });
}
