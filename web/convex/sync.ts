import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireProjectMember } from "./access";
import { isSafeRelativePath } from "./projectPath";
import { takeRateToken } from "./rateLimit";
import { fitsPending, LIMITS, MINUTE_MS } from "./limits";

const MAX_UPDATE = 256 * 1024;
const MAX_FILE = 2 * 1024 * 1024;

function checkPath(path: string) {
  if (!isSafeRelativePath(path)) throw new ConvexError("Invalid project path.");
}

function checkUpdate(update: ArrayBuffer | Uint8Array) {
  if (update.byteLength === 0 || update.byteLength > MAX_UPDATE) throw new ConvexError("Sync update is too large.");
}

// Keep bytes in the public response in Convex's wire representation. This is
// also important in convex-test, where database bytes can come back as a
// Uint8Array even though the response validator accepts ArrayBuffer only.
function responseBytes(value: ArrayBuffer | Uint8Array) {
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export const listFiles = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMember(ctx, projectId);
    return await ctx.db.query("syncFiles").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
  },
});

export const loadFile = query({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }) => {
    await requireProjectMember(ctx, projectId); checkPath(path);
    const file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique();
    if (!file) return null;
    const snapshot = await ctx.db.query("syncSnapshots").withIndex("by_file_version", (q) => q.eq("fileId", file._id).eq("version", file.snapshotVersion)).unique();
    const updates = await ctx.db.query("syncUpdates").withIndex("by_file_version", (q) => q.eq("fileId", file._id).gt("version", file.snapshotVersion)).take(1000);
    return {
      file,
      snapshot: snapshot ? responseBytes(snapshot.state) : new ArrayBuffer(0),
      updates: updates.sort((a, b) => a.version - b.version).map((row) => ({ ...row, update: responseBytes(row.update) })),
    };
  },
});

export const updates = query({
  args: { projectId: v.id("projects"), path: v.string(), afterVersion: v.number() },
  handler: async (ctx, { projectId, path, afterVersion }) => {
    await requireProjectMember(ctx, projectId); checkPath(path);
    const file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique();
    if (!file) return { version: 0, updates: [] };
    const rows = await ctx.db.query("syncUpdates").withIndex("by_file_version", (q) => q.eq("fileId", file._id).gt("version", afterVersion)).take(1000);
    return { version: file.version, updates: rows.sort((a, b) => a.version - b.version).map((row) => ({ ...row, update: responseBytes(row.update) })) };
  },
});

export const pushUpdates = mutation({
  args: { projectId: v.id("projects"), path: v.string(), updates: v.array(v.bytes()), size: v.number() },
  handler: async (ctx, { projectId, path, updates, size }) => {
    const { user } = await requireProjectMember(ctx, projectId); checkPath(path);
    if (size < 0 || size > MAX_FILE || updates.length > 100) throw new ConvexError("File or update batch is too large.");
    for (const update of updates) checkUpdate(update);
    await takeRateToken(ctx, `push:${user._id}:${projectId}`, LIMITS.pushPerMinute, MINUTE_MS, "Too many sync updates. Slow down a little.");
    let file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique();
    // Versions are sequential and a snapshot deletes everything up to its version, so this is the number of unsnapshotted updates.
    if (file && !fitsPending(file.version - file.snapshotVersion, updates.length)) throw new ConvexError("This file needs a snapshot first.");
    if (!file) {
      const now = Date.now(); const id = await ctx.db.insert("syncFiles", { projectId, path, size, snapshotVersion: 0, version: 0, updatedAt: now });
      file = await ctx.db.get(id); if (!file) throw new ConvexError("Could not create sync file.");
    }
    let version = file.version;
    for (const update of updates) await ctx.db.insert("syncUpdates", { fileId: file._id, version: ++version, update, createdAt: Date.now() });
    await ctx.db.patch(file._id, { size, version, updatedAt: Date.now() });
    return version;
  },
});

export const saveSnapshot = mutation({
  args: { projectId: v.id("projects"), path: v.string(), version: v.number(), state: v.bytes(), size: v.number() },
  handler: async (ctx, { projectId, path, version, state, size }) => {
    await requireProjectMember(ctx, projectId); checkPath(path);
    if (state.byteLength > MAX_UPDATE * 8 || size > MAX_FILE) throw new ConvexError("Snapshot is too large.");
    const file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique();
    if (!file || version < file.snapshotVersion || version > file.version) return;
    await ctx.db.insert("syncSnapshots", { fileId: file._id, version, state, createdAt: Date.now() });
    await ctx.db.patch(file._id, { snapshotVersion: version, size, updatedAt: Date.now() });
    const old = await ctx.db.query("syncUpdates").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect();
    for (const row of old) if (row.version <= version) await ctx.db.delete(row._id);
    const oldSnapshots = await ctx.db.query("syncSnapshots").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect();
    for (const row of oldSnapshots) if (row.version < version) await ctx.db.delete(row._id);
  },
});

export const renameFile = mutation({
  args: { projectId: v.id("projects"), path: v.string(), newPath: v.string() },
  handler: async (ctx, { projectId, path, newPath }) => { await requireProjectMember(ctx, projectId); checkPath(path); checkPath(newPath); const file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique(); const target = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", newPath)).unique(); if (target) throw new ConvexError("A file already exists at that path."); if (file) await ctx.db.patch(file._id, { path: newPath, updatedAt: Date.now() }); },
});

export const deleteFile = mutation({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }) => { await requireProjectMember(ctx, projectId); checkPath(path); const file = await ctx.db.query("syncFiles").withIndex("by_project_path", (q) => q.eq("projectId", projectId).eq("path", path)).unique(); if (!file) return; for (const row of await ctx.db.query("syncUpdates").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect()) await ctx.db.delete(row._id); for (const row of await ctx.db.query("syncSnapshots").withIndex("by_file_version", (q) => q.eq("fileId", file._id)).collect()) await ctx.db.delete(row._id); await ctx.db.delete(file._id); },
});
