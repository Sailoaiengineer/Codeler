import { test } from "node:test";
import assert from "node:assert/strict";
import { batchFull, capMentions, fitsPending, joinAllowed, LIMITS, oldestBeyond, underLimit } from "./limits.ts";

test("underLimit allows only while under the max", () => {
  assert.equal(underLimit(0, 120), true);
  assert.equal(underLimit(119, 120), true);
  assert.equal(underLimit(120, 120), false);
});

test("sync pushes fit up to 500 unsnapshotted updates", () => {
  assert.equal(fitsPending(0, 1), true);
  assert.equal(fitsPending(499, 1), true);
  assert.equal(fitsPending(500, 1), false);
  assert.equal(fitsPending(499, 2), false);
  assert.equal(fitsPending(490, 10), true);
  assert.equal(LIMITS.maxPendingUpdates, 500);
});

test("join needs both the person and the team under their limits", () => {
  assert.equal(joinAllowed(0, 0), true);
  assert.equal(joinAllowed(9, 29), true);
  assert.equal(joinAllowed(10, 0), false, "per-person limit");
  assert.equal(joinAllowed(0, 30), false, "per-team limit, even across many accounts");
  assert.equal(joinAllowed(10, 30), false);
});

test("mentions are capped at 20 and keep their order", () => {
  const ids = Array.from({ length: 25 }, (_, i) => `u${i}`);
  const capped = capMentions(ids);
  assert.equal(capped.length, 20);
  assert.deepEqual(capped, ids.slice(0, 20));
  assert.deepEqual(capMentions(["a", "b"]), ["a", "b"]);
});

test("presence keeps the newest windows and evicts the oldest", () => {
  const rows = [
    { id: "w3", lastSeen: 300 },
    { id: "w1", lastSeen: 100 },
    { id: "w5", lastSeen: 500 },
    { id: "w2", lastSeen: 200 },
    { id: "w4", lastSeen: 400 },
  ];
  // A sixth window arrives: keep 4 of the 5 existing ones.
  assert.deepEqual(oldestBeyond(rows, LIMITS.maxPresenceWindows - 1).map((r) => r.id), ["w1"]);
  assert.deepEqual(oldestBeyond(rows.slice(0, 3), 4), []);
  assert.deepEqual(oldestBeyond([], 4), []);
  assert.equal(rows[0].id, "w3", "input is not reordered");
});

test("cleanup reschedules only when its batch was full", () => {
  assert.equal(batchFull(LIMITS.batch - 1), false);
  assert.equal(batchFull(LIMITS.batch), true);
});
