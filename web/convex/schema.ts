import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const role = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

// Codeler's own tables. Auth tables live in the local Better Auth component (betterAuth/schema.ts).
// User ids below are Better Auth user ids (strings).
export default defineSchema({
  teams: defineTable({
    name: v.string(),
    description: v.string(),
    imageId: v.optional(v.id("_storage")),
    ownerId: v.string(),
    // Short code people type to find the team, e.g. "K7Q2-MX4P"; the password is checked separately.
    joinCode: v.string(),
    passwordHash: v.string(), // scrypt, hex
    passwordSalt: v.string(), // hex
    createdAt: v.number(),
  }).index("by_joinCode", ["joinCode"]),

  members: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    role,
    // pending = asked to join and waiting for an Owner/Admin; active = approved.
    status: v.union(v.literal("pending"), v.literal("active")),
    name: v.string(),
    email: v.string(),
    image: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_team_status", ["teamId", "status"])
    .index("by_user", ["userId"])
    .index("by_team_user", ["teamId", "userId"]),

  invites: defineTable({
    teamId: v.id("teams"),
    email: v.string(), // lower-case
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_email", ["email"]),

  projects: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_team", ["teamId"]),

  // Wrong-password attempts, for rate limiting joins.
  joinAttempts: defineTable({
    userId: v.string(),
    at: v.number(),
  }).index("by_user_at", ["userId", "at"]),

  // ChatGPT: live sync
  syncFiles: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    size: v.number(),
    snapshotVersion: v.number(),
    version: v.number(),
    updatedAt: v.number(),
  }).index("by_project_path", ["projectId", "path"]).index("by_project", ["projectId"]),

  syncSnapshots: defineTable({
    fileId: v.id("syncFiles"),
    version: v.number(),
    state: v.bytes(),
    createdAt: v.number(),
  }).index("by_file_version", ["fileId", "version"]),

  syncUpdates: defineTable({
    fileId: v.id("syncFiles"),
    version: v.number(),
    update: v.bytes(),
    createdAt: v.number(),
  }).index("by_file_version", ["fileId", "version"]),

  // ChatGPT: presence
  presence: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    window: v.string(),
    path: v.string(),
    line: v.number(),
    character: v.number(),
    selection: v.object({
      startLine: v.number(), startCharacter: v.number(),
      endLine: v.number(), endCharacter: v.number(),
    }),
    lastSeen: v.number(),
  }).index("by_project", ["projectId"]).index("by_project_window", ["projectId", "window"]),

  // Claude (Haiku): chat + activity
  messages: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.string(),
    image: v.optional(v.string()),
    text: v.string(), // 1-4000 chars, trimmed
    mentions: v.array(v.string()), // Better Auth user ids of people @-mentioned
    attachment: v.optional(v.object({
      storageId: v.id("_storage"), name: v.string(), type: v.string(), size: v.number(),
    })),
    createdAt: v.number(),
  }).index("by_project_created", ["projectId", "createdAt"])
    .index("by_attachment", ["attachment.storageId"]),

  activity: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal("joined"), v.literal("left"), v.literal("approved"),
      v.literal("file_created"), v.literal("file_changed"), v.literal("file_deleted"), v.literal("file_renamed"),
      v.literal("run"), v.literal("snapshot"),
    ),
    detail: v.string(), // <= 300 chars
    createdAt: v.number(),
  }).index("by_project_created", ["projectId", "createdAt"]),

  notifications: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    messageId: v.id("messages"),
    read: v.boolean(),
    createdAt: v.number(),
  }).index("by_user_read", ["userId", "read"]),
});
