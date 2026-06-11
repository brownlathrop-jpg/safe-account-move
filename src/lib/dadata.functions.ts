import { createServerFn } from "@tanstack/react-start";

async function dadataSuggest(endpoint: string, query: string) {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) throw new Error("DADATA_API_KEY не настроен");
  const res = await fetch(`https://suggestions.dadata.ru/suggestions/api/4_1/rs/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify({ query, count: 1 }),
  });
  if (!res.ok) throw new Error(`DaData error ${res.status}`);
  const json = await res.json();
  return json.suggestions?.[0] ?? null;
}

export const lookupOrgByInn = createServerFn({ method: "POST" })
  .inputValidator((d: { inn: string }) => {
    if (!d?.inn || !/^\d{10}(\d{2})?$/.test(d.inn.trim())) throw new Error("Некорректный ИНН");
    return { inn: d.inn.trim() };
  })
  .handler(async ({ data }) => {
    const s = await dadataSuggest("findById/party", data.inn);
    if (!s) return null;
    const d = s.data ?? {};
    const sno = d.finance?.tax_system as string | undefined; // "USN", "ENVD", "PSN"...
    const snoMap: Record<string, string> = {
      USN: "usn_6", ENVD: "osn", PSN: "psn", ESHN: "esxn", SRP: "osn",
    };
    return {
      name: s.value || "",
      full_name: d.name?.full_with_opf || s.unrestricted_value || "",
      inn: d.inn || data.inn,
      kpp: d.kpp || "",
      ogrn: d.ogrn || "",
      okpo: d.okpo || "",
      legal_address: d.address?.unrestricted_value || d.address?.value || "",
      director_name: d.management?.name || "",
      taxation_system: sno ? (snoMap[sno] ?? "") : "",
    };
  });

export const lookupBankByBik = createServerFn({ method: "POST" })
  .inputValidator((d: { bik: string }) => {
    if (!d?.bik || !/^\d{9}$/.test(d.bik.trim())) throw new Error("БИК должен содержать 9 цифр");
    return { bik: d.bik.trim() };
  })
  .handler(async ({ data }) => {
    const s = await dadataSuggest("findById/bank", data.bik);
    if (!s) return null;
    const d = s.data ?? {};
    return {
      bank_name: s.value || "",
      bank_bik: d.bic || data.bik,
      bank_corr_account: d.correspondent_account || "",
    };
  });
