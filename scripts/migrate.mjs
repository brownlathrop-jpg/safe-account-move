#!/usr/bin/env node
// Версионированные миграции: применяет файлы sql/migrations/*.sql по одному разу.
// Запуск: DATABASE_URL=... node scripts/migrate.mjs [--dry]
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { sslOption } from "../selfhost/ssl-option.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "sql", "migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}
const dry = process.argv.includes("--dry");

const sql = postgres(url, { ssl: sslOption(url), max: 1 });

await sql.unsafe(`
  create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now(),
    checksum text
  )`);

const appliedRows = await sql`select version, checksum from schema_migrations`;
const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));

let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
} catch {
  console.error(`Папка ${dir} не найдена`);
  process.exit(1);
}

const sum = (text) => createHash("sha256").update(text).digest("hex");

let count = 0;
for (const file of files) {
  const sqlText = readFileSync(join(dir, file), "utf8");
  const checksum = sum(sqlText);
  if (applied.has(file)) {
    const known = applied.get(file);
    if (known && known !== checksum) {
      console.warn(`внимание: ${file} изменён после применения (контрольная сумма не совпадает)`);
    } else if (!known && !dry) {
      await sql`update schema_migrations set checksum = ${checksum} where version = ${file}`;
    }
    continue;
  }
  if (dry) {
    console.log(`будет применена: ${file}`);
    count++;
    continue;
  }
  process.stdout.write(`применяю ${file} ... `);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlText);
      await tx`insert into schema_migrations (version, checksum) values (${file}, ${checksum})`;
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
