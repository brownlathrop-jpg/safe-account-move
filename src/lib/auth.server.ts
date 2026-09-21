// Свой вход по email и паролю: пароли scrypt, сессия в зашифрованном cookie.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getRequestHeader, useSession } from "@tanstack/react-start/server";
import { sql } from "./pg.server";

export type AppUser = { id: string; email: string; name: string; is_admin?: boolean };

type SessionData = { userId?: string; email?: string };

function sessionConfig() {
  const password = process.env["SESSION_SECRET"];
  if (!password) throw new Error("SESSION_SECRET не задан");
  return {
    password,
    name: "crm-session",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

async function findByEmail(email: string) {
  const s = sql();
  const rows = await s`select * from app_users where lower(email) = lower(${email}) limit 1`;
  return rows.length ? (rows[0] as any) : null;
}

/** Требования к новому паролю. */
export function assertStrongPassword(password: string) {
  if (password.length < 12) throw new Error("Пароль должен быть не короче 12 символов");
}

export async function signUp(email: string, password: string, name = ""): Promise<AppUser> {
  if (!email.includes("@")) throw new Error("Укажите корректный email");
  assertStrongPassword(password);
  const ip = clientIp();
  if (await tooManySignUps(ip)) {
    throw new Error("Слишком много регистраций с этого адреса. Попробуйте позже.");
  }
  if (await findByEmail(email)) throw new Error("Пользователь с таким email уже зарегистрирован");
  const s = sql();
  const rows = await s`
    insert into app_users (email, password_hash, name)
    values (${email}, ${hashPassword(password)}, ${name})
    returning id, email, name`;
  const user = rows[0] as any as AppUser;
  await recordAttempt(`signup:${email}`, ip, true);
  await acceptInvites(user);
  await startSession(user);
  return user;
}


/** IP посетителя (за прокси заголовок ставит nginx). */
function clientIp(): string {
  try {
    const fwd = getRequestHeader("x-forwarded-for") ?? "";
    const first = String(fwd).split(",")[0]?.trim();
    return first || String(getRequestHeader("x-real-ip") ?? "") || "";
  } catch {
    return "";
  }
}

const MAX_EMAIL_TRIES = 5;    // неудачных попыток на один email
const MAX_IP_TRIES = 15;      // неудачных попыток с одного адреса
const WINDOW_MIN = 15;        // за такое время (минут)
const MAX_SIGNUPS_PER_IP = 5; // регистраций с одного адреса
const SIGNUP_WINDOW_MIN = 60; // за такое время (минут)

/** Записать попытку входа и почистить старые записи. */
async function recordAttempt(email: string, ip: string, ok: boolean) {
  try {
    const s = sql();
    await s`insert into auth_attempts (email, ip, ok) values (${email}, ${ip}, ${ok})`;
    await s`delete from auth_attempts where created_at < now() - interval '7 days'`;
  } catch {
    /* журнал попыток не должен ломать вход */
  }
}

/** Раздельные счётчики: свой лимит на email и свой — на IP. */
async function tooManyAttempts(email: string, ip: string): Promise<boolean> {
  try {
    const s = sql();
    const rows = await s`
      select
        count(*) filter (where lower(email) = lower(${email}))::int as by_email,
        count(*) filter (where ${ip} <> '' and ip = ${ip})::int as by_ip
      from auth_attempts
       where ok = false
         and email not like 'signup:%'
         and created_at > now() - (${WINDOW_MIN} || ' minutes')::interval`;
    const r = (rows[0] as any) ?? {};
    return Number(r.by_email ?? 0) >= MAX_EMAIL_TRIES || Number(r.by_ip ?? 0) >= MAX_IP_TRIES;
  } catch {
    return false;
  }
}

/** Слишком много регистраций с одного адреса. */
async function tooManySignUps(ip: string): Promise<boolean> {
  if (!ip) return false;
  try {
    const s = sql();
    const rows = await s`
      select count(*)::int as c from auth_attempts
       where ip = ${ip}
         and email like 'signup:%'
         and created_at > now() - (${SIGNUP_WINDOW_MIN} || ' minutes')::interval`;
    return Number((rows[0] as any)?.c ?? 0) >= MAX_SIGNUPS_PER_IP;
  } catch {
    return false;
  }
}


export async function signIn(email: string, password: string): Promise<AppUser> {
  const ip = clientIp();
  if (await tooManyAttempts(email, ip)) {
    throw new Error("Слишком много попыток входа. Попробуйте через 15 минут.");
  }
  const row = await findByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    await recordAttempt(email, ip, false);
    throw new Error("Неверный email или пароль");
  }
  await recordAttempt(email, ip, true);
  const user: AppUser = { id: row.id, email: row.email, name: row.name ?? "", is_admin: !!row.is_admin };
  await acceptInvites(user);
  await startSession(user);
  return user;
}

/** Принять приглашения, отправленные на этот e-mail. */
async function acceptInvites(user: AppUser) {
  try {
    const { acceptInvitesFor } = await import("./team.server");
    await acceptInvitesFor(user.id, user.email);
  } catch {
    /* приглашения не должны мешать входу */
  }
}

export async function startSession(user: AppUser) {
  const session = await useSession<SessionData>(sessionConfig());
  await session.update({ userId: user.id, email: user.email });
}

export async function signOut() {
  const session = await useSession<SessionData>(sessionConfig());
  await session.clear();
}

export async function currentUser(): Promise<AppUser | null> {
  const session = await useSession<SessionData>(sessionConfig());
  const userId = session.data.userId;
  if (!userId) return null;
  const s = sql();
  const rows = await s`select id, email, name, is_admin from app_users where id = ${userId} limit 1`;
  return rows.length ? (rows[0] as any as AppUser) : null;
}

export async function requireUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new Error("Требуется вход");
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (!user.is_admin) throw new Error("Доступ только для администратора");
  return user;
}

/* --------------------------------------------- личные настройки пользователя */

export async function getUserPrefs(): Promise<Record<string, any>> {
  const user = await requireUser();
  const s = sql();
  const rows = await s`select prefs from app_users where id = ${user.id} limit 1`;
  return ((rows[0] as any)?.prefs ?? {}) as Record<string, any>;
}

export async function setUserPrefs(patch: Record<string, any>): Promise<Record<string, any>> {
  const user = await requireUser();
  const s = sql();
  const rows = await s`
    update app_users
       set prefs = coalesce(prefs, '{}'::jsonb) || ${s.json(patch as any)}::jsonb
     where id = ${user.id}
     returning prefs`;
  return ((rows[0] as any)?.prefs ?? {}) as Record<string, any>;
}

export async function changePassword(newPassword: string) {
  assertStrongPassword(newPassword);
  const user = await requireUser();
  const s = sql();
  await s`update app_users set password_hash = ${hashPassword(newPassword)} where id = ${user.id}`;
}

/** Создаёт токен восстановления. Отправка письма настраивается отдельно. */
export async function createResetToken(email: string): Promise<string | null> {
  const row = await findByEmail(email);
  if (!row) return null;
  const token = randomBytes(24).toString("hex");
  const s = sql();
  await s`
    insert into password_resets (token, user_id, expires_at)
    values (${token}, ${row.id}, now() + interval '2 hours')`;
  return token;
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  assertStrongPassword(newPassword);
  const s = sql();
  const rows = await s`
    select * from password_resets
    where token = ${token} and used_at is null and expires_at > now() limit 1`;
  if (!rows.length) throw new Error("Ссылка недействительна или устарела");
  const reset = rows[0] as any;
  await s`update app_users set password_hash = ${hashPassword(newPassword)} where id = ${reset.user_id}`;
  await s`update password_resets set used_at = now() where token = ${token}`;
}
