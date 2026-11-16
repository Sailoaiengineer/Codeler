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
});
