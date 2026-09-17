// Серверные функции: доступ к базе и вход. Браузер вызывает только их.
import { createServerFn } from "@tanstack/react-start";

export const dbQuery = createServerFn({ method: "POST" })
  .inputValidator((input: any) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { runQuery } = await import("./pg.server");
    let user;
    try {
      user = await requireUser();
    } catch {
      return { data: null, error: { message: "Требуется вход" } };
    }
    return runQuery(data, user.id);
  });

export const dbGetById = createServerFn({ method: "POST" })
  .inputValidator((input: { table: string; id: string }) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { getRowById } = await import("./pg.server");
    try {
      await requireUser();
    } catch {
      return { data: null, error: { message: "Требуется вход" } };
    }
    try {
      return { data: await getRowById(data.table, data.id), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const authSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { signIn } = await import("./auth.server");
    try {
      return { user: await signIn(data.email, data.password), error: null };
    } catch (e: any) {
      return { user: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const authSignUp = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string; name?: string }) => input)
  .handler(async ({ data }) => {
    const { signUp } = await import("./auth.server");
    try {
      return { user: await signUp(data.email, data.password, data.name ?? ""), error: null };
    } catch (e: any) {
      return { user: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const authSignOut = createServerFn({ method: "POST" }).handler(async () => {
  const { signOut } = await import("./auth.server");
  await signOut();
  return { ok: true };
});

export const authMe = createServerFn({ method: "POST" }).handler(async () => {
  const { currentUser } = await import("./auth.server");
  try {
    return { user: await currentUser(), error: null };
  } catch (e: any) {
    return { user: null, error: { message: e?.message ?? String(e) } };
  }
});

export const authChangePassword = createServerFn({ method: "POST" })
  .inputValidator((input: { password: string }) => input)
  .handler(async ({ data }) => {
    const { changePassword } = await import("./auth.server");
    try {
      await changePassword(data.password);
      return { ok: true, error: null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? String(e) } };
    }
  });

export const authRequestReset = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const { createResetToken } = await import("./auth.server");
    try {
      const token = await createResetToken(data.email);
      if (token) console.log(`[reset] ссылка восстановления: /auth?reset=${token}`);
      // Ответ одинаковый, существует адрес или нет.
      return { ok: true, error: null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? String(e) } };
    }
  });

export const authResetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { resetPasswordWithToken } = await import("./auth.server");
    try {
      await resetPasswordWithToken(data.token, data.password);
      return { ok: true, error: null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? String(e) } };
    }
  });

export const storageUpload = createServerFn({ method: "POST" })
  .inputValidator((input: { bucket: string; path: string; contentType: string; base64: string }) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    try {
      await requireUser();
      const s = sql();
      const bytes = Buffer.from(data.base64, "base64");
      await s`
        insert into files (id, bucket, path, content_type, bytes)
        values (${crypto.randomUUID()}, ${data.bucket}, ${data.path}, ${data.contentType}, ${bytes})
        on conflict (bucket, path) do update
          set bytes = excluded.bytes, content_type = excluded.content_type`;
      return { path: data.path, error: null };
    } catch (e: any) {
      return { path: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const storageRemove = createServerFn({ method: "POST" })
  .inputValidator((input: { bucket: string; paths: string[] }) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    try {
      await requireUser();
      const s = sql();
      await s`delete from files where bucket = ${data.bucket} and path = any(${data.paths})`;
      return { ok: true, error: null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? String(e) } };
    }
  });
