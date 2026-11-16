import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireProjectMember } from "./access";

const MAX_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "application/pdf", "application/zip"]);
const SEND_LIMIT = 30; // messages per user per window
const WINDOW_MS = 60_000;

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

// Finds @Name mentions of the given member names. Longer names win ("@Sam Lee" does not also ping "Sam").
// Same rule as mentionedNames() in extensions/codeler/src/chat/logic.ts; keep the two in step.
function mentionedNames(text: string, names: string[]): string[] {
  let rest = text.toLowerCase();
  const found: string[] = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const needle = "@" + name.toLowerCase();
    if (needle.length < 2) continue;
    for (let at = rest.indexOf(needle); at !== -1; at = rest.indexOf(needle, at + needle.length)) {
      if (isWord(rest[at - 1]) || isWord(rest[at + needle.length])) continue;
      found.push(name);
      rest = rest.slice(0, at) + " ".repeat(needle.length) + rest.slice(at + needle.length);
    }
  }
  return found;
}

export const members = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { project } = await requireProjectMember(ctx, projectId);
    const rows = await ctx.db.query("members")
      .withIndex("by_team_status", (q) => q.eq("teamId", project.teamId).eq("status", "active")).take(500);
    return rows.map((m) => ({ userId: m.userId, name: m.name }));
  },
});

export const send = mutation({
  args: { projectId: v.id("projects"), text: v.string() },
  handler: async (ctx, { projectId, text }) => {
    const { user, member, project } = await requireProjectMember(ctx, projectId);
    const body = text.trim();
    if (body.length < 1 || body.length > 4000) throw new ConvexError("Messages need 1 to 4000 characters.");

    const since = Date.now() - WINDOW_MS;
    const recent = await ctx.db.query("messages")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId).gte("createdAt", since))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .take(SEND_LIMIT);
    if (recent.length >= SEND_LIMIT) throw new ConvexError("Slow down: 30 messages a minute is the limit.");

    // Only active members can be mentioned; pending people are ignored.
    const active = await ctx.db.query("members")
      .withIndex("by_team_status", (q) => q.eq("teamId", project.teamId).eq("status", "active")).take(500);
    const named = new Set(mentionedNames(body, active.map((m) => m.name)));
    const mentions = [...new Set(active.filter((m) => named.has(m.name) && m.userId !== user._id).map((m) => m.userId))];

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      projectId, userId: user._id, name: member.name, image: member.image, text: body, mentions, createdAt: now,
    });
    for (const userId of mentions) {
      await ctx.db.insert("notifications", { userId, projectId, messageId, read: false, createdAt: now });
    }
    return messageId;
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId);
    const rows = await ctx.db.query("messages")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc").take(100);
    return await Promise.all(rows.reverse().map(async (m) => ({
      _id: m._id, userId: m.userId, name: m.name, image: m.image ?? null, text: m.text, mentions: m.mentions, createdAt: m.createdAt,
      attachment: m.attachment
        ? { name: m.attachment.name, type: m.attachment.type, size: m.attachment.size, url: await ctx.storage.getUrl(m.attachment.storageId) }
        : null,
    })));
  },
});

export const generateUploadUrl = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId);
    return await ctx.storage.generateUploadUrl();
  },
});

// Called after send(): links an uploaded file to the sender's own message. Checks the stored file, not what the client claims.
export const attach = mutation({
  args: { projectId: v.id("projects"), messageId: v.id("messages"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, { projectId, messageId, storageId, name }) => {
    const { user } = await requireProjectMember(ctx, projectId);
    const message = await ctx.db.get(messageId);
    if (!message || message.projectId !== projectId) throw new ConvexError("That message is gone.");
    if (message.userId !== user._id) throw new ConvexError("You can only attach files to your own messages.");
    if (message.attachment) throw new ConvexError("This message already has a file.");
    // Uploads are not tied to a user, so any signed-in member could otherwise attach someone else's stored file.
    // A file must be fresh and not already attached to another message.
    const taken = await ctx.db.query("messages").withIndex("by_attachment", (q) => q.eq("attachment.storageId", storageId)).first();
    if (taken) throw new ConvexError("That file is already attached to a message.");
    const stored = await ctx.db.system.get(storageId);
    if (!stored || Date.now() - stored._creationTime > 10 * 60 * 1000) throw new ConvexError("The upload expired. Attach the file again.");
    const meta = await ctx.storage.getMetadata(storageId);
    if (!meta) throw new ConvexError("The upload didn't finish. Try again.");
    const type = (meta.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!FILE_TYPES.has(type)) throw new ConvexError("That file type isn't allowed.");
    if (meta.size > MAX_BYTES) throw new ConvexError("Files can be up to 10 MB.");
    const cleanName = name.replace(/[\\/\0]/g, "_").trim().slice(0, 200);
    if (!cleanName) throw new ConvexError("The file needs a name.");
    await ctx.db.patch(messageId, { attachment: { storageId, name: cleanName, type, size: meta.size } });
  },
});

export const unread = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { user } = await requireProjectMember(ctx, projectId);
    const rows = await ctx.db.query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("read", false)).take(100);
    return rows.filter((r) => r.projectId === projectId).length;
  },
});

// Marks only the caller's own unread mentions in this project as read.
export const markRead = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const { user } = await requireProjectMember(ctx, projectId);
    const rows = await ctx.db.query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("read", false)).take(100);
    for (const row of rows) if (row.projectId === projectId) await ctx.db.patch(row._id, { read: true });
  },
});
