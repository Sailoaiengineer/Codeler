import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireMember, requireUser } from "./access";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s: string, max: number) => s.trim().replace(/\s+/g, " ").slice(0, max);

// ---- Internal: called only by the actions in teamsNode.ts (which hash passwords) ----

export const insertTeam = internalMutation({
  args: {
    userId: v.string(), name: v.string(), email: v.string(), image: v.optional(v.string()),
    teamName: v.string(), description: v.string(), joinCode: v.string(),
    passwordHash: v.string(), passwordSalt: v.string(),
    invites: v.array(v.object({ email: v.string(), role: v.union(v.literal("admin"), v.literal("member")) })),
  },
  handler: async (ctx, a) => {
    const name = clean(a.teamName, 60);
    if (!name) throw new ConvexError("Give your team a name.");
    if (a.invites.length > 50) throw new ConvexError("You can invite up to 50 people at once.");
    const taken = await ctx.db.query("teams").withIndex("by_joinCode", (q) => q.eq("joinCode", a.joinCode)).first();
    if (taken) return null; // caller retries with a new code
    const now = Date.now();
    const teamId = await ctx.db.insert("teams", {
      name, description: a.description.trim().slice(0, 500), ownerId: a.userId, joinCode: a.joinCode,
      passwordHash: a.passwordHash, passwordSalt: a.passwordSalt, createdAt: now,
    });
    await ctx.db.insert("members", {
      teamId, userId: a.userId, role: "owner", status: "active", name: a.name, email: a.email, image: a.image, createdAt: now,
    });
    await ctx.db.insert("projects", { teamId, name, createdBy: a.userId, createdAt: now });
    const seen = new Set<string>();
    for (const inv of a.invites) {
      const email = inv.email.trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254 || seen.has(email) || email === a.email.toLowerCase()) continue;
      seen.add(email);
      await ctx.db.insert("invites", { teamId, email, role: inv.role, invitedBy: a.userId, createdAt: now });
    }
    return teamId;
  },
});

export const secretByCode = internalQuery({
  args: { joinCode: v.string() },
  handler: async (ctx, { joinCode }) => {
    const team = await ctx.db.query("teams").withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode)).first();
    return team && { teamId: team._id, passwordHash: team.passwordHash, passwordSalt: team.passwordSalt };
  },
});

export const recentAttempts = internalQuery({
  args: { userId: v.string(), since: v.number() },
  handler: async (ctx, { userId, since }) =>
    (await ctx.db.query("joinAttempts").withIndex("by_user_at", (q) => q.eq("userId", userId).gte("at", since)).take(50)).length,
});

export const recordAttempt = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await ctx.db.insert("joinAttempts", { userId, at: Date.now() });
  },
});

export const addPending = internalMutation({
  args: { teamId: v.id("teams"), userId: v.string(), name: v.string(), email: v.string(), image: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("members").withIndex("by_team_user", (q) => q.eq("teamId", a.teamId).eq("userId", a.userId)).unique();
    if (existing) return { status: existing.status };
    const invite = await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", a.email.toLowerCase()))
      .filter((q) => q.eq(q.field("teamId"), a.teamId)).first();
    await ctx.db.insert("members", {
      teamId: a.teamId, userId: a.userId, role: invite?.role ?? "member", status: "pending",
      name: a.name, email: a.email, image: a.image, createdAt: Date.now(),
    });
    return { status: "pending" as const };
  },
});

export const setPassword = internalMutation({
  args: { teamId: v.id("teams"), userId: v.string(), passwordHash: v.string(), passwordSalt: v.string() },
  handler: async (ctx, a) => {
    const team = await ctx.db.get(a.teamId);
    if (!team || team.ownerId !== a.userId) throw new ConvexError("Only the team owner can change the password.");
    await ctx.db.patch(a.teamId, { passwordHash: a.passwordHash, passwordSalt: a.passwordSalt });
  },
});

// ---- Public ----

/** Teams I'm in (active) and teams I've asked to join (pending). Feeds the Workspaces list. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", user._id)).take(200);
    const out = [];
    for (const m of rows) {
      const team = await ctx.db.get(m.teamId);
      if (!team) continue;
      if (m.status === "pending") {
        out.push({ teamId: team._id, name: team.name, role: m.role, status: m.status });
        continue;
      }
      const projects = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", team._id)).take(100);
      const waiting = m.role === "member" ? 0 : (await ctx.db.query("members")
        .withIndex("by_team_status", (q) => q.eq("teamId", team._id).eq("status", "pending")).take(100)).length;
      out.push({
        teamId: team._id, name: team.name, role: m.role, status: m.status, waiting,
        projects: projects.map((p) => ({ id: p._id, name: p.name })),
        // Only Owner/Admin see the code they share with new people.
        joinCode: m.role === "member" ? undefined : team.joinCode,
      });
    }
    return out;
  },
});

/** Active members (for avatars, Collaborators) and, for Owner/Admin, the waiting list. */
export const people = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const { member } = await requireMember(ctx, teamId);
    const pick = (m: { _id: unknown; userId: string; name: string; email: string; image?: string; role: string }) =>
      ({ id: m._id, userId: m.userId, name: m.name, email: m.email, image: m.image ?? null, role: m.role });
    const active = await ctx.db.query("members").withIndex("by_team_status", (q) => q.eq("teamId", teamId).eq("status", "active")).take(500);
    const pending = member.role === "member" ? [] :
      await ctx.db.query("members").withIndex("by_team_status", (q) => q.eq("teamId", teamId).eq("status", "pending")).take(200);
    return { me: member.role, active: active.map(pick), pending: pending.map(pick) };
  },
});

export const approve = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const row = await ctx.db.get(memberId);
    if (!row || row.status !== "pending") throw new ConvexError("That request is no longer waiting.");
    const { member } = await requireMember(ctx, row.teamId, ["owner", "admin"]);
    // Admins can't create admins: an invite for "admin" only applies when the Owner approves.
    const role = row.role === "admin" && member.role !== "owner" ? "member" : row.role;
    await ctx.db.patch(memberId, { status: "active", role });
  },
});

export const deny = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const row = await ctx.db.get(memberId);
    if (!row || row.status !== "pending") throw new ConvexError("That request is no longer waiting.");
    await requireMember(ctx, row.teamId, ["owner", "admin"]);
    await ctx.db.delete(memberId);
  },
});

/** Owner removes anyone but themselves; Admin removes Members only. Members can leave (remove themselves). */
export const remove = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const row = await ctx.db.get(memberId);
    if (!row) return;
    const { user, member } = await requireMember(ctx, row.teamId);
    const self = row.userId === user._id;
    if (row.role === "owner") throw new ConvexError(self ? "Owners can't leave their own team." : "The owner can't be removed.");
    const allowed = self || member.role === "owner" || (member.role === "admin" && row.role === "member");
    if (!allowed) throw new ConvexError("You don't have permission to do that.");
    await ctx.db.delete(memberId);
  },
});

export const setRole = mutation({
  args: { memberId: v.id("members"), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { memberId, role }) => {
    const row = await ctx.db.get(memberId);
    if (!row || row.status !== "active") throw new ConvexError("That person isn't on the team.");
    await requireMember(ctx, row.teamId, ["owner"]);
    if (row.role === "owner") throw new ConvexError("The owner's role can't be changed.");
    await ctx.db.patch(memberId, { role });
  },
});

export const invite = mutation({
  args: { teamId: v.id("teams"), email: v.string(), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { teamId, email: raw, role }) => {
    const { user, member } = await requireMember(ctx, teamId, ["owner", "admin"]);
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
    if (role === "admin" && member.role !== "owner") throw new ConvexError("Only the owner can invite admins.");
    const dup = await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("teamId"), teamId)).first();
    if (dup) return;
    await ctx.db.insert("invites", { teamId, email, role, invitedBy: user._id, createdAt: Date.now() });
  },
});

/** Owner only: deleting a team removes members, invites and projects. */
export const deleteTeam = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireMember(ctx, teamId, ["owner"]);
    // shortcut: also needs to delete live-sync/chat data once those tables exist; one transaction caps at a few thousand rows
    const members = await ctx.db.query("members").withIndex("by_team_status", (q) => q.eq("teamId", teamId)).collect();
    const invites = await ctx.db.query("invites").withIndex("by_team", (q) => q.eq("teamId", teamId)).collect();
    const projects = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", teamId)).collect();
    for (const r of [...members, ...invites, ...projects]) await ctx.db.delete(r._id);
    await ctx.db.delete(teamId);
  },
});
