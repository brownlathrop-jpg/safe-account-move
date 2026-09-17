/** Выгрузка товаров и папок из Firestore в /tmp для анализа. */
import { cert } from "firebase-admin/app";

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credential = cert(svc);
const REST = `https://firestore.googleapis.com/v1/projects/${svc.project_id}/databases/(default)/documents`;

const fromValue = (v) => {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  return null;
};

async function listAll(table) {
  const out = [];
  let pageToken = "";
  do {
    const t = (await credential.getAccessToken()).access_token;
    const url = new URL(`${REST}/${table}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const d of data.documents ?? []) {
      const row = { id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields ?? {})) row[k] = fromValue(v);
      out.push(row);
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

const products = await listAll("products");
const folders = await listAll("product_folders");
await Bun.write("/tmp/products.json", JSON.stringify(products));
await Bun.write("/tmp/folders.json", JSON.stringify(folders));
console.log("products", products.length, "folders", folders.length);
console.log(JSON.stringify(products.slice(0, 5), null, 1));
console.log(JSON.stringify(folders.slice(0, 20), null, 1));
