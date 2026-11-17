import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireMember, requireProjectMember } from "./access";

const MAX_PROJECTS = 100;

const cleanName = (raw: string) => {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new ConvexError("Project names need 1 to 60 characters.");
  return name;
};

export const create = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  handler: async (ctx, { teamId, name: raw }) => {
    const { user } = await requireMember(ctx, teamId, ["owner", "admin"]);
    const name = cleanName(raw);
    const existing = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", teamId)).take(MAX_PROJECTS);
    if (existing.length >= MAX_PROJECTS) throw new ConvexError("A team can have up to 100 projects.");
    if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new ConvexError("A project with that name already exists.");
    return await ctx.db.insert("projects", { teamId, name, createdBy: user._id, createdAt: Date.now() });
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name: raw }) => {
    const { project } = await requireProjectMember(ctx, projectId, ["owner", "admin"]);
    const name = cleanName(raw);
    const siblings = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", project.teamId)).take(MAX_PROJECTS);
    if (siblings.some((p) => p._id !== projectId && p.name.toLowerCase() === name.toLowerCase())) throw new ConvexError("A project with that name already exists.");
    await ctx.db.patch(projectId, { name });
  },
});

/** Owner only. Deletes the project and every row keyed by it: sync files, snapshots, updates, presence, messages, notifications, activity. */
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId, ["owner"]);
    // shortcut: collects each table in one transaction, so a very large project may hit transaction limits, upgrade to batched deletes when that happens
    const files = await ctx.db.query("syncFiles").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    for (const file of files) {
      const snapshots = await ctx.db.query("syncSnapshots").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect();
      for (const row of snapshots) await ctx.db.delete(row._id);
      const updates = await ctx.db.query("syncUpdates").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect();
      for (const row of updates) await ctx.db.delete(row._id);
      await ctx.db.delete(file._id);
    }
    const presence = await ctx.db.query("presence").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    for (const row of presence) await ctx.db.delete(row._id);
    const messages = await ctx.db.query("messages").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).collect();
    for (const row of messages) {
      if (row.attachment) await ctx.storage.delete(row.attachment.storageId);
      await ctx.db.delete(row._id);
    }
    const notifications = await ctx.db.query("notifications").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    for (const row of notifications) await ctx.db.delete(row._id);
    const activity = await ctx.db.query("activity").withIndex("by_project_created", (q) => q.eq("projectId", projectId)).collect();
    for (const row of activity) await ctx.db.delete(row._id);
    await ctx.db.delete(projectId);
  },
});
