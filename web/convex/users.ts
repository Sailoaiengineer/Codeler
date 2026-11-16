import { query } from "./_generated/server";
import { getUser } from "./auth";

// What the desktop app shows in the title bar and avatars. Only the caller's own profile.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return null;
    return { id: user._id, name: user.name, email: user.email, image: user.image ?? null };
  },
});
