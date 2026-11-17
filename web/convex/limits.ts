// Pure limit rules shared by the Convex functions. No Convex imports here, so limits.test.ts can run it with node --test.

const MINUTE = 60_000;

export const LIMITS = {
  pushPerMinute: 600, // sync:pushUpdates per user per project; the client pushes each edited file every 500 ms, so 120 throttled anyone editing several files
  activityPerMinute: 60, // activity:record per user per project
  uploadUrlPerMinute: 20, // chat:generateUploadUrl per user
  maxPendingUpdates: 500, // unsnapshotted sync updates per file
  maxMentions: 20, // @-mentions that notify people, per message
  maxPresenceWindows: 5, // editor windows per user per project
  joinUserTries: 10, // team password tries per person...
  joinUserWindowMs: 15 * MINUTE, // ...in this window
  joinTeamTries: 30, // tries against one team code...
  joinTeamWindowMs: 60 * MINUTE, // ...in this window
  minTeamPassword: 10,
  presenceStaleMs: 2 * MINUTE,
  uploadSweepAgeMs: 60 * MINUTE, // unattached uploads older than this are deleted
  rateEventKeepMs: 60 * MINUTE, // rate-limit history older than this is pruned
  batch: 500, // rows per cleanup pass, then the pass reschedules itself if it was full
} as const;

export const MINUTE_MS = MINUTE;

/** True while another event still fits in the window. */
export function underLimit(recent: number, max: number): boolean {
  return recent < max;
}

/** A push is fine while the file's unsnapshotted updates stay at or under the cap. */
export function fitsPending(pending: number, incoming: number): boolean {
  return pending + incoming <= LIMITS.maxPendingUpdates;
}

/** Both the person's and the team code's tries must be under their limits. */
export function joinAllowed(userTries: number, teamTries: number): boolean {
  return underLimit(userTries, LIMITS.joinUserTries) && underLimit(teamTries, LIMITS.joinTeamTries);
}

export function capMentions<T>(ids: T[]): T[] {
  return ids.slice(0, LIMITS.maxMentions);
}

/** The least recently seen rows, so that at most `keep` rows remain. */
export function oldestBeyond<T extends { lastSeen: number }>(rows: T[], keep: number): T[] {
  if (rows.length <= keep) return [];
  return [...rows].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, rows.length - keep);
}

/** A cleanup pass that filled its batch may have more work, so it runs again. */
export function batchFull(count: number): boolean {
  return count >= LIMITS.batch;
}
