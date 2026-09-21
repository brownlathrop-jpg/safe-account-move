#!/usr/bin/env node
// Версионированные миграции: применяет файлы sql/migrations/*.sql по одному разу.
// Запуск: DATABASE_URL=... node scripts/migrate.mjs [--dry]
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "sql", "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
const local = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);

const client = new pg.Client({
  connectionString: url,
  ssl: local ? false : { rejectUnauthorized: false },
});
await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now(),
    checksum text
  )`);

const applied = new Set(
  (await client.query("select version from schema_migrations")).rows.map((r) => r.version),
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
    await client.query("begin");
    await client.query(sqlText);
    await client.query("insert into schema_migrations (version) values ($1)", [file]);
    await client.query("commit");
    console.log("готово");
    count++;
  } catch (e) {
    await client.query("rollback");
    console.error(`ошибка\n${e.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(count ? `Миграций применено: ${count}` : "Новых миграций нет");
await client.end();
