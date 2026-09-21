// Настройки шифрования подключения к PostgreSQL — общие для приложения и миграций.
// Локальная база — без SSL. Внешняя — с SSL; если задан PGSSLROOTCERT,
// сертификат сервера проверяется по нему, иначе проверка ослаблена.
import { readFileSync } from "node:fs";

export function sslOption(url) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])/.test(String(url));
  if (local) return false;
  const rootCert = process.env.PGSSLROOTCERT;
  if (rootCert) {
    try {
      return { ca: readFileSync(rootCert, "utf8"), rejectUnauthorized: true };
    } catch {
      /* нет файла сертификата — падаем в ослабленный режим ниже */
    }
  }
  return { rejectUnauthorized: false };
}
