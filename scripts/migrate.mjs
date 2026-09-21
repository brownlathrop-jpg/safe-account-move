#!/usr/bin/env node
// Версионированные миграции: применяет файлы sql/migrations/*.sql по одному разу.
// Запуск: DATABASE_URL=... node scripts/migrate.mjs [--dry]
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "sql", "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
const local = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);

const sql = postgres(url, { ssl: local ? false : { rejectUnauthorized: false }, max: 1 });

await sql.unsafe(`
  create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now(),
    checksum text
  )`);

const applied = new Set(
  (await sql`select version from schema_migrations`).map((r) => r.version),
);

let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
} catch {
  console.error(`Папка ${dir} не найдена`);
  process.exit(1);
}

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sqlText = readFileSync(join(dir, file), "utf8");
  if (dry) {
    console.log(`будет применена: ${file}`);
    count++;
    continue;
  }
  process.stdout.write(`применяю ${file} ... `);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlText);
      await tx`insert into schema_migrations (version) values (${file})`;
    });
    console.log("готово");
    count++;
  } catch (e) {
    console.error(`ошибка\n${e.message}`);
    await sql.end();
    process.exit(1);
  }
}

console.log(count ? `Миграций применено: ${count}` : "Новых миграций нет");
await sql.end();
