import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("clean up stale presence", { minutes: 2 }, internal.presence.cleanup, {});
crons.interval("delete unattached uploads", { hours: 1 }, internal.chat.sweepUploads, {});
crons.interval("prune rate limit events", { hours: 1 }, internal.rateLimit.prune, {});
export default crons;
