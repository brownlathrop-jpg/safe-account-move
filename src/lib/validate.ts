// Проверка данных, приходящих из браузера в серверные функции.
import { z } from "zod";

const id = z.string().min(1).max(200);
const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,62}$/, "Недопустимое имя поля");

export const filterSchema = z.object({
  op: z.enum(["eq", "neq", "in", "gte", "lte", "gt", "lt", "isnull", "notnull"]),
  field: fieldName,
  value: z.any().optional(),
});

export const querySpecSchema = z.object({
  table: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
  mode: z.enum(["select", "insert", "update", "upsert", "delete"]),
  select: z.string().max(2000).optional(),
  filters: z.array(filterSchema).max(50).optional(),
  orders: z.array(z.object({ field: fieldName, asc: z.boolean() })).max(10).optional(),
  limit: z.number().int().min(0).max(100000).nullable().optional(),
  range: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).nullable().optional(),
  payload: z.array(z.record(z.any())).max(5000).optional(),
  onConflict: z.array(fieldName).max(5).optional(),
  single: z.enum(["one", "maybe"]).nullable().optional(),
  head: z.boolean().optional(),
  count: z.boolean().optional(),
});

export const getByIdSchema = z.object({ table: z.string().min(1).max(63), id });

export const emailSchema = z.string().trim().min(3).max(200).email("Укажите корректный e-mail");
export const passwordSchema = z.string().min(6).max(200);
/** Новый пароль: не короче 12 символов. */
export const newPasswordSchema = z
  .string()
  .min(12, "Пароль должен быть не короче 12 символов")
  .max(200);

export const signInSchema = z.object({ email: emailSchema, password: passwordSchema });
export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  name: z.string().max(200).optional(),
});
export const resetRequestSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({ token: z.string().min(10).max(200), password: newPasswordSchema });
export const changePasswordSchema = z.object({ password: newPasswordSchema });


export const uploadSchema = z.object({
  bucket: z.string().min(1).max(64),
  path: z.string().min(1).max(300),
  contentType: z.string().min(3).max(100),
  base64: z.string().max(8 * 1024 * 1024),
  workspaceId: id.nullable().optional(),
});
export const removeFilesSchema = z.object({
  bucket: z.string().min(1).max(64),
  paths: z.array(z.string().min(1).max(300)).max(200),
  workspaceId: id.nullable().optional(),
});

export const roleSchema = z.enum(["owner", "manager", "storekeeper", "viewer"]);
export const workspaceIdSchema = z.object({ workspaceId: id });
export const memberSchema = z.object({ workspaceId: id, memberId: id });
export const memberRoleSchema = z.object({ workspaceId: id, memberId: id, role: roleSchema });
export const memberOrgSchema = z.object({ workspaceId: id, memberId: id, orgId: id.nullable() });
export const inviteSchema = z.object({ workspaceId: id, email: emailSchema, role: roleSchema });
export const revokeInviteSchema = z.object({ workspaceId: id, token: z.string().min(10).max(200) });
export const docHistorySchema = z.object({ table: z.string().min(1).max(63), docId: id });
export const workspaceHistorySchema = z.object({
  workspaceId: id,
  kind: z.enum(["all", "changes", "views"]).optional(),
});
export const logViewSchema = z.object({
  workspaceId: id.nullable(),
  section: z.string().min(1).max(64),
});
export const prefsSchema = z.object({ patch: z.record(z.any()) });

/* --------------------------------- прочие серверные функции */

export const searchSchema = z.object({
  q: z.string().max(200),
  workspaceId: id.nullable().optional(),
});
export const saveItemSchema = z.record(z.any());
export const invoiceSaveSchema = z.object({
  invoiceId: id,
  header: z.record(z.any()),
  items: z.array(saveItemSchema).max(5000),
});
export const invoiceCreateSchema = z.object({
  workspaceId: id,
  header: z.record(z.any()),
  items: z.array(saveItemSchema).max(5000),
});
export const workspaceOnlySchema = z.object({ workspaceId: id });
export const costProductSchema = z.object({ workspaceId: id, productId: id });
export const adminCreateUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().max(200).optional(),
});
export const adminUserPasswordSchema = z.object({ userId: id, password: passwordSchema });
export const adminUserFlagSchema = z.object({ userId: id, isAdmin: z.boolean() });
export const adminUserSchema = z.object({ userId: id });
export const adminQuerySchema = z.object({ query: z.string().min(1).max(5000) });
