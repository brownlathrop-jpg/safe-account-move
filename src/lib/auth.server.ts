// Свой вход по email и паролю: пароли scrypt, сессия в зашифрованном cookie.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
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

export async function signUp(email: string, password: string, name = ""): Promise<AppUser> {
  if (!email.includes("@")) throw new Error("Укажите корректный email");
  if (password.length < 6) throw new Error("Пароль должен быть не короче 6 символов");
  if (await findByEmail(email)) throw new Error("Пользователь с таким email уже зарегистрирован");
  const s = sql();
  const rows = await s`
    insert into app_users (email, password_hash, name)
    values (${email}, ${hashPassword(password)}, ${name})
    returning id, email, name`;
  const user = rows[0] as any as AppUser;
  await startSession(user);
  return user;
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  const row = await findByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error("Неверный email или пароль");
  }
  const user: AppUser = { id: row.id, email: row.email, name: row.name ?? "" };
  await startSession(user);
  return user;
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

export async function changePassword(newPassword: string) {
  if (newPassword.length < 6) throw new Error("Пароль должен быть не короче 6 символов");
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
  if (newPassword.length < 6) throw new Error("Пароль должен быть не короче 6 символов");
  const s = sql();
  const rows = await s`
    select * from password_resets
    where token = ${token} and used_at is null and expires_at > now() limit 1`;
  if (!rows.length) throw new Error("Ссылка недействительна или устарела");
  const reset = rows[0] as any;
  await s`update app_users set password_hash = ${hashPassword(newPassword)} where id = ${reset.user_id}`;
  await s`update password_resets set used_at = now() where token = ${token}`;
}
