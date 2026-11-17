import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { emailAllowed } from "./allowList";

// The desktop app identifies itself with this id in the device sign-in flow; nothing else may start one.
export const DESKTOP_CLIENT_ID = "codeler-desktop";

export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),
    // Google is the only way in: it proves the Gmail address is real and gives us name + photo for avatars.
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        prompt: "select_account",
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days, refreshed while the app is used
      updateAge: 60 * 60 * 24,
    },
    user: { deleteUser: { enabled: true } },
    // Only emails in ALLOWED_EMAILS (Convex env) can create an account; returning false blocks it.
    databaseHooks: {
      user: { create: { before: async (user) => emailAllowed(user.email, process.env.ALLOWED_EMAILS) ? undefined : false } },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        // read on every page load / token refresh; limiting these locks everyone out in local dev
        "/get-session": false,
        "/convex/token": false,
        "/convex/jwks": false,
        // the app polls this every few seconds while you sign in; the plugin enforces its own interval
        "/device/token": false,
        "/device/code": { window: 60, max: 5 },
        "/device/approve": { window: 60, max: 10 },
        "/device/deny": { window: 60, max: 10 },
      },
    },
    plugins: [
      convex({ authConfig }),
      // Desktop sign-in: the app gets a short code, the browser approves it, the app polls for a session token.
      deviceAuthorization({
        expiresIn: "10m",
        interval: "5s",
        verificationUri: "/device",
        validateClient: (clientId) => clientId === DESKTOP_CLIENT_ID,
      }),
      // Lets the desktop app send that session token as `Authorization: Bearer` to get its Convex token.
      bearer(),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

// The signed-in user, or undefined. Use in every query/mutation that needs a person.
export const getUser = (ctx: GenericCtx<DataModel>) => authComponent.safeGetAuthUser(ctx);
