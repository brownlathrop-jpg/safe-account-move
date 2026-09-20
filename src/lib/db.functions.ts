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
    return runQuery(data, user.id, user.email ?? "");
  });

export const dbGetById = createServerFn({ method: "POST" })
  .inputValidator((input: { table: string; id: string }) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { getRowById } = await import("./pg.server");
    const { accessibleWorkspaces } = await import("./team.server");
    let user;
    try {
      user = await requireUser();
    } catch {
      return { data: null, error: { message: "Требуется вход" } };
    }
    try {
      const scope = await accessibleWorkspaces(user.id);
      return { data: await getRowById(data.table, data.id, scope), error: null };
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
    const { sendMail, appUrl, resetEmailHtml } = await import("./email.server");
    try {
      const token = await createResetToken(data.email);
      if (token) {
        const link = `${appUrl()}/auth?reset=${token}`;
        await sendMail({
          to: data.email,
          subject: "Смена пароля в КабинетCRM",
          html: resetEmailHtml(link),
        });
      }
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

/** Максимальный размер картинки — 5 МБ. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export const storageUpload = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      bucket: string;
      path: string;
      contentType: string;
      base64: string;
      workspaceId?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    const { roleIn, canWrite } = await import("./team.server");
    try {
      const user = await requireUser();
      if (!data.workspaceId) throw new Error("Не указана база");
      const role = await roleIn(user.id, data.workspaceId);
      if (!role) throw new Error("Нет доступа к этой базе");
      if (!canWrite(role, "products")) throw new Error("Недостаточно прав для загрузки файлов");
      if (!ALLOWED_TYPES.has(data.contentType)) throw new Error("Можно загружать только картинки");
      const bytes = Buffer.from(data.base64, "base64");
      if (bytes.length > MAX_FILE_BYTES) throw new Error("Файл больше 5 МБ");
      const s = sql();
      const upd = await s`
        update files
           set bytes = ${bytes}, content_type = ${data.contentType}
         where bucket = ${data.bucket} and path = ${data.path}
           and workspace_id = ${data.workspaceId}
        returning path`;
      if (!upd.length) {
        const busy = await s`
          select 1 from files where bucket = ${data.bucket} and path = ${data.path} limit 1`;
        if (busy.length) throw new Error("Нет доступа к этому файлу");
        await s`
          insert into files (id, bucket, path, content_type, bytes, workspace_id)
          values (${crypto.randomUUID()}, ${data.bucket}, ${data.path}, ${data.contentType},
                  ${bytes}, ${data.workspaceId})`;
      }
      return { path: data.path, error: null };
    } catch (e: any) {
      return { path: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const storageRemove = createServerFn({ method: "POST" })
  .inputValidator((input: { bucket: string; paths: string[]; workspaceId?: string | null }) => input)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./auth.server");
    const { sql } = await import("./pg.server");
    const { roleIn, canWrite } = await import("./team.server");
    try {
      const user = await requireUser();
      if (!data.workspaceId) throw new Error("Не указана база");
      const role = await roleIn(user.id, data.workspaceId);
      if (!role) throw new Error("Нет доступа к этой базе");
      if (!canWrite(role, "products")) throw new Error("Недостаточно прав для удаления файлов");
      const s = sql();
      await s`
        delete from files
         where bucket = ${data.bucket} and path = any(${data.paths})
           and workspace_id = ${data.workspaceId}`;
      return { ok: true, error: null };
    } catch (e: any) {
      return { ok: false, error: { message: e?.message ?? String(e) } };
    }
  });

export const userPrefsGet = createServerFn({ method: "POST" }).handler(async () => {
  const { getUserPrefs } = await import("./auth.server");
  try {
    return { prefs: await getUserPrefs(), error: null };
  } catch (e: any) {
    return { prefs: {}, error: { message: e?.message ?? String(e) } };
  }
});

export const userPrefsSet = createServerFn({ method: "POST" })
  .inputValidator((input: { patch: Record<string, any> }) => input)
  .handler(async ({ data }) => {
    const { setUserPrefs } = await import("./auth.server");
    try {
      return { prefs: await setUserPrefs(data.patch ?? {}), error: null };
    } catch (e: any) {
      return { prefs: {}, error: { message: e?.message ?? String(e) } };
    }
  });
