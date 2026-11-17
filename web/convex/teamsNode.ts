"use node";
// Team actions that need Node's crypto (password hashing). Database work is in teams.ts (internal functions).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getUser } from "./auth";
import { LIMITS } from "./limits";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

function hash(password: string, saltHex: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, Buffer.from(saltHex, "hex"), KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function checkPassword(password: string) {
  if (password.length < LIMITS.minTeamPassword) throw new ConvexError(`The team password needs at least ${LIMITS.minTeamPassword} characters.`);
  if (password.length > 128) throw new ConvexError("The team password can be at most 128 characters.");
}

// Codes people type: no 0/O or 1/I/L to avoid mix-ups. 8 chars from 30 = ~6.5e11 combinations.
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function joinCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export const createTeam = action({
  args: {
    name: v.string(),
    description: v.string(),
    password: v.string(),
    invites: v.array(v.object({ email: v.string(), role: v.union(v.literal("admin"), v.literal("member")) })),
  },
  handler: async (ctx, args): Promise<{ teamId: string; joinCode: string }> => {
    const user = await getUser(ctx);
    if (!user) throw new ConvexError("Sign in to Codeler first.");
    checkPassword(args.password);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hash(args.password, salt)).toString("hex");
    // A clash is astronomically unlikely, but retry rather than fail.
    for (let i = 0; i < 5; i++) {
      const code = joinCode();
      const teamId = await ctx.runMutation(internal.teams.insertTeam, {
        userId: user._id, name: user.name, email: user.email, image: user.image ?? undefined,
        teamName: args.name, description: args.description, joinCode: code,
        passwordHash, passwordSalt: salt, invites: args.invites,
      });
      if (teamId) return { teamId, joinCode: code };
    }
    throw new ConvexError("Couldn't create the team. Try again.");
  },
});

/** Ask to join: right code + password puts you on the team's waiting list for an Owner/Admin to approve. */
export const requestJoin = action({
  args: { joinCode: v.string(), password: v.string() },
  handler: async (ctx, { joinCode: rawCode, password }): Promise<{ status: "pending" | "active" }> => {
    const user = await getUser(ctx);
    if (!user) throw new ConvexError("Sign in to Codeler first.");
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
    // Checked and recorded before scrypt, so guessing can't burn CPU past the limit.
    const allowed = await ctx.runMutation(internal.teams.takeJoinAttempt, { userId: user._id, code });
    if (!allowed) throw new ConvexError("Too many tries. Wait a while and try again.");

    const secret = await ctx.runQuery(internal.teams.secretByCode, { joinCode: code });
    // Hash even when the code is unknown, so timing doesn't reveal which codes exist.
    const actual = await hash(password.slice(0, 128), secret?.passwordSalt ?? "00".repeat(16));
    const expected = Buffer.from(secret?.passwordHash ?? "00".repeat(KEY_LEN), "hex");
    if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ConvexError("Wrong team code or password.");
    }
    return await ctx.runMutation(internal.teams.addPending, {
      teamId: secret.teamId, userId: user._id, name: user.name, email: user.email, image: user.image ?? undefined,
    });
  },
});

/** Owner only. Existing members stay; new joiners need the new password. */
export const changePassword = action({
  args: { teamId: v.id("teams"), password: v.string() },
  handler: async (ctx, { teamId, password }) => {
    const user = await getUser(ctx);
    if (!user) throw new ConvexError("Sign in to Codeler first.");
    checkPassword(password);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await hash(password, salt)).toString("hex");
    await ctx.runMutation(internal.teams.setPassword, { teamId, userId: user._id, passwordHash, passwordSalt: salt });
  },
});
