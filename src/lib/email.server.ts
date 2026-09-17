// Отправка писем через Resend (шлюз Lovable). Только серверный код.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const FROM = "КабинетCRM <noreply@skladnow.ru>";

export async function sendMail(opts: { to: string; subject: string; html: string }) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) throw new Error("Почтовый сервис не настроен");

  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[email] ошибка отправки [${response.status}]: ${body}`);
    throw new Error("Не удалось отправить письмо");
  }
  return true;
}

export function appUrl(): string {
  return process.env["APP_URL"] || "https://crm.skladnow.ru";
}

export function resetEmailHtml(link: string): string {
  return `
  <div style="font-family:Arial,sans-serif;background:#ffffff;padding:24px;color:#111827">
    <h2 style="margin:0 0 12px">Смена пароля в КабинетCRM</h2>
    <p style="margin:0 0 16px">Вы запросили смену пароля. Нажмите кнопку ниже — ссылка действует 2 часа.</p>
    <p style="margin:0 0 20px">
      <a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
        Задать новый пароль
      </a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280">Если это были не вы — просто удалите письмо, пароль останется прежним.</p>
  </div>`;
}

export function inviteEmailHtml(link: string, existingUser: boolean): string {
  const text = existingUser
    ? "Вам открыли доступ к рабочей базе. Войдите под своим обычным паролем — новая база появится в списке."
    : "Вас пригласили работать в КабинетCRM. Нажмите кнопку, задайте пароль — и сразу попадёте в базу.";
  return `
  <div style="font-family:Arial,sans-serif;background:#ffffff;padding:24px;color:#111827">
    <h2 style="margin:0 0 12px">Приглашение в КабинетCRM</h2>
    <p style="margin:0 0 16px">${text}</p>
    <p style="margin:0 0 20px">
      <a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
        ${existingUser ? "Открыть КабинетCRM" : "Принять приглашение"}
      </a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280">Ссылка действует 14 дней.</p>
  </div>`;
}

