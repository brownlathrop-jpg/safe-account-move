// Серверные функции для работы командой: участники, роли, приглашения, история.
import { createServerFn } from "@tanstack/react-start";

async function ctx() {
  const { requireUser } = await import("./auth.server");
  const team = await import("./team.server");
  const user = await requireUser();
  return { user, team };
}

/** Только владелец базы управляет составом участников. */
async function requireOwner(workspaceId: string) {
  const { user, team } = await ctx();
  const role = await team.roleIn(user.id, workspaceId);
  if (role !== "owner") throw new Error("Только владелец базы может управлять сотрудниками");
  return { user, team };
}

export const teamMyWorkspaces = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { user, team } = await ctx();
    return { data: await team.myWorkspaces(user.id), error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e) } };
  }
});

export const teamMyRole = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      return { data: await team.roleIn(user.id, data.workspaceId), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamList = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      const role = await team.roleIn(user.id, data.workspaceId);
      if (!role) throw new Error("Нет доступа к этой базе");
      return { data: await team.listMembers(data.workspaceId), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; email: string; role: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await requireOwner(data.workspaceId);
      const res = await team.createInvite({
        workspaceId: data.workspaceId,
        email: data.email,
        role: data.role as any,
        invitedBy: user.id,
      });
      const { sendMail, appUrl, inviteEmailHtml } = await import("./email.server");
      const link = res.existingUser
        ? `${appUrl()}/auth`
        : `${appUrl()}/auth?invite=${res.token}&email=${encodeURIComponent(data.email)}`;
      try {
        await sendMail({
          to: data.email,
          subject: "Вас пригласили в КабинетCRM",
          html: inviteEmailHtml(link, res.existingUser),
        });
      } catch {
        /* письмо могло не уйти — доступ всё равно выдан */
      }
      return { data: { existingUser: res.existingUser }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamSetRole = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; memberId: string; role: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { team } = await requireOwner(data.workspaceId);
      await team.setMemberRole(data.workspaceId, data.memberId, data.role as any);
      return { data: true, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamRemove = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; memberId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { team } = await requireOwner(data.workspaceId);
      await team.removeMember(data.workspaceId, data.memberId);
      return { data: true, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamRevokeInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; token: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { team } = await requireOwner(data.workspaceId);
      await team.revokeInvite(data.workspaceId, data.token);
      return { data: true, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamDocHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { table: string; docId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      const scope = await team.accessibleWorkspaces(user.id);
      return { data: await team.docHistory(data.table, data.docId, scope), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamWorkspaceHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; kind?: "all" | "changes" | "views" }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      const role = await team.roleIn(user.id, data.workspaceId);
      if (!role) throw new Error("Нет доступа к этой базе");
      return {
        data: await team.workspaceHistory(data.workspaceId, 200, data.kind ?? "all"),
        error: null,
      };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

/** Записать, что сотрудник открыл важный раздел. */
export const teamLogView = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string | null; section: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      await team.logView({
        section: data.section,
        workspaceId: data.workspaceId,
        userId: user.id,
        userEmail: user.email ?? "",
      });
      return { data: true, error: null };
    } catch {
      return { data: null, error: null };
    }
  });

export const teamSetOrg = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; memberId: string; orgId: string | null }) => input)
  .handler(async ({ data }) => {
    try {
      const { team } = await requireOwner(data.workspaceId);
      await team.setMemberOrg(data.workspaceId, data.memberId, data.orgId);
      return { data: true, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });

export const teamDocAuthors = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    try {
      const { user, team } = await ctx();
      const role = await team.roleIn(user.id, data.workspaceId);
      if (!role) throw new Error("Нет доступа к этой базе");
      return { data: await team.docAuthors(data.workspaceId), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? String(e) } };
    }
  });
