// Better Auth tables, installed locally so the device sign-in flow (desktop app login) has its table.
// Copied from @convex-dev/better-auth 0.12.5's default schema, trimmed to what Codeler uses
// (Google sign-in only), plus `deviceCode` from better-auth's device-authorization plugin.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const opt = <T extends Parameters<typeof v.optional>[0]>(t: T) => v.optional(v.union(v.null(), t));

export const tables = {
  user: defineTable({
    name: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    image: opt(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: opt(v.string()),
  })
    .index("email_name", ["email", "name"])
    .index("name", ["name"])
    .index("userId", ["userId"]),
  session: defineTable({
    expiresAt: v.number(),
    token: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ipAddress: opt(v.string()),
    userAgent: opt(v.string()),
    userId: v.string(),
  })
    .index("expiresAt", ["expiresAt"])
    .index("expiresAt_userId", ["expiresAt", "userId"])
    .index("token", ["token"])
    .index("userId", ["userId"]),
  account: defineTable({
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    accessToken: opt(v.string()),
    refreshToken: opt(v.string()),
    idToken: opt(v.string()),
    accessTokenExpiresAt: opt(v.number()),
    refreshTokenExpiresAt: opt(v.number()),
    scope: opt(v.string()),
    password: opt(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("accountId", ["accountId"])
    .index("accountId_providerId", ["accountId", "providerId"])
    .index("providerId_userId", ["providerId", "userId"])
    .index("userId", ["userId"]),
  verification: defineTable({
    identifier: v.string(),
    value: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("expiresAt", ["expiresAt"])
    .index("identifier", ["identifier"]),
  jwks: defineTable({
    publicKey: v.string(),
    privateKey: v.string(),
    createdAt: v.number(),
    expiresAt: opt(v.number()),
  }),
  rateLimit: defineTable({
    key: v.string(),
    count: v.number(),
    lastRequest: v.number(),
  }).index("key", ["key"]),
  deviceCode: defineTable({
    deviceCode: v.string(),
    userCode: v.string(),
    userId: opt(v.string()),
    expiresAt: v.number(),
    status: v.string(),
    lastPolledAt: opt(v.number()),
    pollingInterval: opt(v.number()),
    clientId: opt(v.string()),
    scope: opt(v.string()),
  })
    .index("deviceCode", ["deviceCode"])
    .index("userCode", ["userCode"])
    .index("expiresAt", ["expiresAt"]),
};

export default defineSchema(tables);
