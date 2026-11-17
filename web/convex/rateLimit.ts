import { internalMutation, type MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { batchFull, LIMITS, underLimit } from "./limits";

/** Counts this key's recent events and records one more, in the same transaction. Throws when over the limit. */
export async function takeRateToken(ctx: MutationCtx, key: string, max: number, windowMs: number, message: string): Promise<void> {
  const now = Date.now();
  const recent = await ctx.db.query("rateEvents")
    .withIndex("by_key_at", (q) => q.eq("key", key).gte("at", now - windowMs))
    .take(max);
  if (!underLimit(recent.length, max)) throw new ConvexError(message);
  await ctx.db.insert("rateEvents", { key, at: now });
}

// Hourly, from crons.ts. Only the last minute of events matters to any limit above.
export const prune = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const rows = await ctx.db.query("rateEvents")
      .withIndex("by_at", (q) => q.lt("at", Date.now() - LIMITS.rateEventKeepMs))
      .take(LIMITS.batch);
    for (const row of rows) await ctx.db.delete(row._id);
    if (batchFull(rows.length)) await ctx.scheduler.runAfter(0, internal.rateLimit.prune, {});
  },
});
