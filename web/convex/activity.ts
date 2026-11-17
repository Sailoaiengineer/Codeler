import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireProjectMember } from "./access";

export const record = mutation({
  args: {
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("joined"), v.literal("left"), v.literal("approved"),
      v.literal("file_created"), v.literal("file_changed"), v.literal("file_deleted"), v.literal("file_renamed"),
      v.literal("run"), v.literal("snapshot"), v.literal("removed"),
    ),
    detail: v.string(),
  },
  handler: async (ctx, { projectId, kind, detail }) => {
    const { user, member } = await requireProjectMember(ctx, projectId);
    const text = detail.trim();
    if (text.length < 1 || text.length > 300) throw new ConvexError("Activity details need 1 to 300 characters.");
    await ctx.db.insert("activity", { projectId, userId: user._id, name: member.name, kind, detail: text, createdAt: Date.now() });
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId);
    const rows = await ctx.db.query("activity")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc").take(100);
    return rows.reverse().map((a) => ({ _id: a._id, userId: a.userId, name: a.name, kind: a.kind, detail: a.detail, createdAt: a.createdAt }));
  },
});
