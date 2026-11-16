import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { getUser } from "./auth";

// Every Codeler query/mutation that touches team data starts with one of these.
// They throw instead of returning null so a missing check can't silently leak data.

type Ctx = QueryCtx | MutationCtx;
export type Role = Doc<"members">["role"];

export async function requireUser(ctx: Ctx) {
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("Sign in to Codeler first.");
  return user;
}

/** The caller's membership, which must be active and (optionally) one of `roles`. */
export async function requireMember(ctx: Ctx, teamId: Id<"teams">, roles?: Role[]) {
  const user = await requireUser(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", user._id))
    .unique();
  // Same error for "no such team", "not a member" and "still pending": don't reveal which teams exist.
  if (!member || member.status !== "active") throw new ConvexError("You're not a member of this team.");
  if (roles && !roles.includes(member.role)) throw new ConvexError("You don't have permission to do that.");
  return { user, member };
}

/** Membership check for anything keyed by project (files, sync, history, presence). */
export async function requireProjectMember(ctx: Ctx, projectId: Id<"projects">, roles?: Role[]) {
  const project = await ctx.db.get(projectId);
  if (!project) throw new ConvexError("You're not a member of this team.");
  const { user, member } = await requireMember(ctx, project.teamId, roles);
  return { user, member, project };
}
