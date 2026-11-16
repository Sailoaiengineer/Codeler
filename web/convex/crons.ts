import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("clean up stale presence", { minutes: 2 }, internal.presence.cleanup, {});
export default crons;
