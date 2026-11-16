import { scryptSync } from "node:crypto";
import { defineTestApp } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// Better Auth's component needs its own registered component and generated API.
// The access-control tests only need the caller identity, so keep authentication
// local and deterministic instead of changing production auth code.
vi.mock("./auth", () => ({
  getUser: async (ctx: { auth: { getUserIdentity: () => Promise<{ subject: string; name?: string; email?: string; picture?: string } | null> } }) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity && {
      _id: identity.subject,
      name: identity.name ?? identity.subject,
      email: identity.email ?? `${identity.subject}@test.local`,
      image: identity.picture,
    };
  },
}));

import * as presence from "./presence";
import * as sync from "./sync";
import * as teams from "./teams";
import * as teamsNode from "./teamsNode";
import schema from "./schema";

const app = defineTestApp({ schema });
const { api, internal, createTest } = app.defineModules({ teams, teamsNode, sync, presence });

const identity = (subject: string) => ({
  subject,
  name: subject === "owner" ? "Owner" : "Member",
  email: `${subject}@example.test`,
});

async function projectFor(t: ReturnType<typeof createTest>, teamId: string) {
  return t.run(async (ctx) => await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", teamId as never)).first());
}

async function makeTeam(t: ReturnType<typeof createTest>) {
  const owner = t.withIdentity(identity("owner"));
  const teamId = await owner.mutation(internal.teams.insertTeam, {
    userId: "owner", name: "Owner", email: "owner@example.test", teamName: "Pairing", description: "Test team",
    joinCode: "ABCD-EFGH", passwordHash: "00", passwordSalt: "00", invites: [],
  });
  if (!teamId) throw new Error("team was not created");
  const project = await projectFor(t, teamId);
  if (!project) throw new Error("project was not created");
  return { owner, teamId, projectId: project._id };
}

async function expectRejected(work: Promise<unknown>, message: RegExp) {
  await expect(work).rejects.toThrow(message);
}

function convexBytes(update: Uint8Array): ArrayBuffer {
  return update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength) as ArrayBuffer;
}

describe("two-user live sync and presence", () => {
  beforeEach(() => vi.useRealTimers());

  it("creates, approves, and enforces active membership for teams, sync, and presence", async () => {
    const t = createTest();
    const { owner, teamId, projectId } = await makeTeam(t);
    const member = t.withIdentity(identity("member"));
    const pending = await member.mutation(internal.teams.addPending, {
      teamId, userId: "member", name: "Member", email: "member@example.test",
    });
    expect(pending.status).toBe("pending");

    await expectRejected(member.query(api.teams.people, { teamId }), /not a member/);
    await expectRejected(member.query(api.sync.listFiles, { projectId }), /not a member/);
    await expectRejected(member.query(api.presence.list, { projectId }), /not a member/);
    const outsider = t.withIdentity(identity("outsider"));
    await expectRejected(outsider.query(api.teams.people, { teamId }), /not a member/);

    const people = await owner.query(api.teams.people, { teamId });
    const pendingId = people.pending.find((row) => row.userId === "member")?.id;
    if (!pendingId) throw new Error("pending member was not listed");
    await owner.mutation(api.teams.approve, { memberId: pendingId });

    const mine = await member.query(api.teams.mine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("active");
  });

  it("converges concurrent Yjs updates for both users, then renames and deletes", async () => {
    const t = createTest();
    const { owner, projectId } = await makeTeam(t);
    const member = t.withIdentity(identity("member"));
    const pending = await member.mutation(internal.teams.addPending, {
      teamId: (await owner.query(api.teams.mine, {}))[0].teamId,
      userId: "member", name: "Member", email: "member@example.test",
    });
    const waiting = await owner.query(api.teams.people, { teamId: (await owner.query(api.teams.mine, {}))[0].teamId });
    await owner.mutation(api.teams.approve, { memberId: waiting.pending[0].id });
    expect(pending.status).toBe("pending");

    const left = new Y.Doc();
    left.getText("text").insert(0, "owner");
    const right = new Y.Doc();
    right.getText("text").insert(0, "member");
    await owner.mutation(api.sync.pushUpdates, { projectId, path: "src/shared.ts", updates: [convexBytes(Y.encodeStateAsUpdate(left))], size: 5 });
    await member.mutation(api.sync.pushUpdates, { projectId, path: "src/shared.ts", updates: [convexBytes(Y.encodeStateAsUpdate(right))], size: 6 });

    const loaded = await member.query(api.sync.loadFile, { projectId, path: "src/shared.ts" });
    expect(loaded?.updates).toHaveLength(2);
    const one = new Y.Doc();
    const two = new Y.Doc();
    for (const row of loaded?.updates ?? []) {
      Y.applyUpdate(one, new Uint8Array(row.update));
      Y.applyUpdate(two, new Uint8Array(row.update));
    }
    expect(one.getText("text").toString()).toBe(two.getText("text").toString());
    expect(one.getText("text").toString()).toContain("owner");
    expect(one.getText("text").toString()).toContain("member");

    await owner.mutation(api.sync.renameFile, { projectId, path: "src/shared.ts", newPath: "src/renamed.ts" });
    expect((await member.query(api.sync.listFiles, { projectId })).map((file) => file.path)).toEqual(["src/renamed.ts"]);
    await member.mutation(api.sync.deleteFile, { projectId, path: "src/renamed.ts" });
    expect(await owner.query(api.sync.listFiles, { projectId })).toEqual([]);
  });

  it("shows the other user, marks yourself, and filters stale presence", async () => {
    const t = createTest();
    const { owner, teamId, projectId } = await makeTeam(t);
    const member = t.withIdentity(identity("member"));
    await member.mutation(internal.teams.addPending, { teamId, userId: "member", name: "Member", email: "member@example.test" });
    const pending = await owner.query(api.teams.people, { teamId });
    await owner.mutation(api.teams.approve, { memberId: pending.pending[0].id });
    await owner.mutation(api.presence.heartbeat, { projectId, window: "owner-window", path: "src/a.ts", cursor: { line: 2, character: 4 }, selection: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 4 } });
    await member.mutation(api.presence.heartbeat, { projectId, window: "member-window", path: "src/b.ts", cursor: { line: 7, character: 1 }, selection: { startLine: 7, startCharacter: 1, endLine: 7, endCharacter: 1 } });

    const rows = await owner.query(api.presence.list, { projectId });
    expect(rows.find((row) => row.userId === "owner")?.isMe).toBe(true);
    expect(rows.find((row) => row.userId === "member")?.isMe).toBe(false);
    await t.run(async (ctx) => {
      const stale = await ctx.db.query("presence").withIndex("by_project_window", (q) => q.eq("projectId", projectId).eq("window", "member-window")).unique();
      if (stale) await ctx.db.patch(stale._id, { lastSeen: Date.now() - 31_000 });
    });
    expect((await owner.query(api.presence.list, { projectId })).map((row) => row.userId)).toEqual(["owner"]);
  });

  it("blocks the eleventh wrong join password after ten attempts", async () => {
    const t = createTest();
    const owner = t.withIdentity(identity("owner"));
    const salt = "00112233445566778899aabbccddeeff";
    const passwordHash = scryptSync("correct-password", Buffer.from(salt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
    await owner.mutation(internal.teams.insertTeam, {
      userId: "owner", name: "Owner", email: "owner@example.test", teamName: "Rate limit", description: "Test team",
      joinCode: "RATE-LIMIT", passwordHash, passwordSalt: salt, invites: [],
    });
    const joiner = t.withIdentity(identity("joiner"));
    for (let i = 0; i < 10; i++) await expectRejected(joiner.action(api.teamsNode.requestJoin, { joinCode: "RATE-LIMIT", password: "wrong-password" }), /Wrong team code or password/);
    await expectRejected(joiner.action(api.teamsNode.requestJoin, { joinCode: "RATE-LIMIT", password: "wrong-password" }), /Too many wrong tries/);
  });
});
