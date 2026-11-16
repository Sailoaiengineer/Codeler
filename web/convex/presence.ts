import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireProjectMember } from "./access";

const validPath = (path: string) => {
  if (!path || path.includes("\0") || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.every((part) => part !== ".." && part !== "") && !parts.some((part) => ["node_modules", ".git", ".codeler", "dist", "out", ".next"].includes(part));
};
const checkPath = (path: string) => { if (!validPath(path)) throw new ConvexError("Invalid project path."); };

const point = v.object({ line: v.number(), character: v.number() });
const selection = v.object({ startLine: v.number(), startCharacter: v.number(), endLine: v.number(), endCharacter: v.number() });

export const heartbeat = mutation({
  args: { projectId: v.id("projects"), window: v.string(), path: v.string(), cursor: point, selection },
  handler: async (ctx, a) => {
    const { user } = await requireProjectMember(ctx, a.projectId);
    if (!a.window || a.window.length > 120) throw new ConvexError("Invalid presence window.");
    checkPath(a.path);
    for (const n of [a.cursor.line, a.cursor.character, a.selection.startLine, a.selection.startCharacter, a.selection.endLine, a.selection.endCharacter])
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new ConvexError("Invalid cursor position.");
    const existing = await ctx.db.query("presence").withIndex("by_project_window", q => q.eq("projectId", a.projectId).eq("window", a.window)).unique();
    const value = { projectId: a.projectId, userId: user._id, window: a.window, path: a.path, line: a.cursor.line, character: a.cursor.character, selection: a.selection, lastSeen: Date.now() };
    if (existing && existing.userId !== user._id) throw new ConvexError("That presence window belongs to another user.");
    if (existing) await ctx.db.patch(existing._id, value); else await ctx.db.insert("presence", value);
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId);
    const cutoff = Date.now() - 30_000;
    const rows = await ctx.db.query("presence").withIndex("by_project", q => q.eq("projectId", projectId)).collect();
    const project = await ctx.db.get(projectId);
    if (!project) return [];
    const members = await ctx.db.query("members").withIndex("by_team_status", q => q.eq("teamId", project.teamId).eq("status", "active")).collect();
    const byUser = new Map(members.map(m => [m.userId, m]));
    return rows.filter(r => r.lastSeen >= cutoff).flatMap(r => { const m = byUser.get(r.userId); return m ? [{ userId: r.userId, name: m.name, image: m.image ?? null, path: r.path, line: r.line, character: r.character, selection: r.selection, lastSeen: r.lastSeen }] : []; });
  },
});
