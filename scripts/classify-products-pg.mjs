/**
 * Раскладывает все товары по папкам (Производитель -> Тип изделия) в PostgreSQL.
 * Что не распознано — в папку «Разобрать». Пустые папки после раскладки удаляются.
 * Запуск: DATABASE_URL=... bun scripts/classify-products-pg.mjs [--apply]
 */
import postgres from "postgres";
import { createHash } from "crypto";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 4, prepare: false, ssl: { rejectUnauthorized: false } });

const fid = (s) => {
  const h = createHash("sha1").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const L = "A-Za-zА-Яа-яЁё0-9";
const w = (body) => new RegExp(`(?:^|[^${L}])(?:${body})(?![${L}])`, "i");

const BRANDS = [
  ["Solo Porte", /solo\s*porte/i],
  ["Uberture", /uberture/i],
  ["Дера", w("дера")],
  ["Дубрава", /дубрава/i],
  ["Матадор", /матадор/i],
  ["ВДК", w("вдк")],
  ["ВФД", w("вфд")],
  ["Собрание", /собрание/i],
  ["Foret Light", /foret\s*light/i],
  ["Foret", w("foret")],
  ["Lidman", /lidman/i],
  ["Casa Porte", /casa\s*porte/i],
  ["Avanzati", /avanzati/i],
  ["La Stella", /la\s*stella|lastella/i],
  ["Легро", /легро/i],
  ["Миракс", /миракс/i],
  ["Тренто", /тренто/i],
  ["Верда", /верда/i],
  ["Биланчино", /биланчино/i],
  ["ElDorf", /eldorf/i],
  ["Prizma", /prizma/i],
  ["Сварог", /сварог/i],
  ["Bussare", /bussare/i],
  ["Маяк", w("маяк")],
];

const TYPES = [
  ["Доборы", /добор/i],
  ["Наличники", /наличник/i],
  ["Короба", /\bкороб/i],
  ["Погонаж", /погонаж|стоевая|уплотнител/i],
  ["Двери", /^\s*(ДП|ДО|ДГ|ПГ|ПО|Д[ПОГ])[\s.]|дверь|полотно|дверное/i],
];

const SERVICE_WORDS = /установк|замер|доставк|разгрузк|погрузк|подъем|подъём|сборк|монтаж|демонтаж|облагораживание|услуг|работы/i;
const MATERIALS = /плинтус|уголок|угол наружный|угол внутренний|заглушк|соединительный элемент|брус|брусок|саморез|шпатл|шпакл|серпянк|гкл|гипсокартон|линолеум|профиль|потолок|решетк|выключател|счетчик|счётчик|розетк|клей|грунтовк|пена монтажная|лента|скотч|штукатурк|плита|фанера|двп|дсп|лдсп/i;
const HARDWARE_KITS = /сводорасширител|карниз|направляющ|ролик|комплект \(|раздвижн|доводчик/i;
const FURNITURE = /ручк|замок|замк|защелк|петл|цилиндр|накладка на цилиндр|фиксатор|доводчик|упор|шпингалет|крючок|порог|завертк|ответная планка|apecs|ajax|бордер|code deco/i;

function classify(p) {
  const name = p.name ?? "";
  if (p.kind === "service" || p.is_service || SERVICE_WORDS.test(name)) return ["Услуги", null];
  if (FURNITURE.test(name)) {
    const t = TYPES.find(([, re]) => re.test(name));
    return ["Фурнитура", t && t[0] !== "Двери" ? t[0] : null];
  }
  if (HARDWARE_KITS.test(name)) return ["Комплектующие", null];
  if (MATERIALS.test(name)) return ["Стройматериалы", null];
  const brand = BRANDS.find(([, re]) => re.test(name));
  const type = TYPES.find(([, re]) => re.test(name));
  if (brand) return [brand[0], type ? type[0] : "Прочее"];
  if (type) return [type[0], null];
  return ["Разобрать", null];
}

const products = (await sql`select id, workspace_id, user_id, data from products`).map((r) => ({
  ...r.data,
  id: r.id,
  workspace_id: r.workspace_id,
  user_id: r.user_id,
}));
const folders = (await sql`select id, workspace_id, user_id, data from product_folders`).map((r) => ({
  ...r.data,
  id: r.id,
  workspace_id: r.workspace_id,
  user_id: r.user_id,
}));

const newFolders = [];
const moves = [];
const stat = new Map();
const byWs = new Map();
for (const p of products) {
  const a = byWs.get(p.workspace_id) ?? [];
  a.push(p);
  byWs.set(p.workspace_id, a);
}

for (const [wsId, list] of byWs) {
  const userId = list[0]?.user_id ?? null;
  const key = (name, parent) => `${parent ?? ""}|${(name ?? "").trim().toLowerCase()}`;
  // индекс только по нашим (созданным раскладкой) папкам — старые дубли не переиспользуем
  const index = new Map();
  const ensure = (name, parentId) => {
    const k = key(name, parentId);
    const hit = index.get(k);
    if (hit) return hit;
    const now = new Date().toISOString();
    const f = {
      id: fid(`${wsId}|${parentId ?? ""}|${name}`),
      name,
      parent_id: parentId ?? null,
      workspace_id: wsId,
      user_id: userId,
      created_at: now,
      updated_at: now,
    };
    index.set(k, f);
    newFolders.push(f);
    return f;
  };

  for (const p of list) {
    const [root, sub] = classify(p);
    const rootFolder = ensure(root, null);
    const target = sub ? ensure(sub, rootFolder.id) : rootFolder;
    const label = sub ? `${root} / ${sub}` : root;
    stat.set(label, (stat.get(label) ?? 0) + 1);
    if (p.folder_id !== target.id) moves.push({ id: p.id, folder_id: target.id });
  }
}

for (const [k, v] of [...stat].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(5)}  ${k}`);
console.log(`\nновых папок: ${newFolders.length}, товаров переместить: ${moves.length}, было папок: ${folders.length}`);

if (!APPLY) {
  console.log("предпросмотр, запустите с --apply");
  await sql.end();
  process.exit(0);
}

for (let i = 0; i < newFolders.length; i += 200) {
  const chunk = newFolders.slice(i, i + 200).map((f) => ({
    id: f.id,
    workspace_id: f.workspace_id,
    user_id: f.user_id,
    data: f,
  }));
  await sql`
    insert into product_folders ${sql(chunk, "id", "workspace_id", "user_id", "data")}
    on conflict (id) do update set data = excluded.data, updated_at = now()`;
}
console.log("папки созданы");

for (let i = 0; i < moves.length; i += 500) {
  const chunk = moves.slice(i, i + 500);
  await sql`
    update products p set
      data = p.data || jsonb_build_object('folder_id', m.folder_id, 'updated_at', now()::text),
      updated_at = now()
    from (values ${sql(chunk.map((m) => [m.id, m.folder_id]))}) as m(id, folder_id)
    where p.id = m.id`;
  process.stdout.write(`\rтоваров перемещено ${Math.min(i + 500, moves.length)}/${moves.length}   `);
}
console.log();

// удаляем пустые папки (без товаров и без вложенных)
let removed = 0;
for (;;) {
  const res = await sql`
    delete from product_folders f
    where not exists (select 1 from products p where p.data->>'folder_id' = f.id)
      and not exists (select 1 from product_folders c where c.data->>'parent_id' = f.id)`;
  if (res.count === 0) break;
  removed += res.count;
}
console.log(`удалено пустых папок: ${removed}`);
console.log(`итого папок: ${(await sql`select count(*)::int c from product_folders`)[0].c}`);
await sql.end();
