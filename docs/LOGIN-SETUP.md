# Codeler login setup

1. Create a Convex project at the Convex dashboard. From `web/`, run `npx convex dev` once and choose that project. This creates `web/convex/_generated/`; do not commit secrets.

2. Set the Convex environment variables for the deployment:

   - `SITE_URL`: the public URL of the Codeler web site, such as `https://codeler.example.com`.
   - `BETTER_AUTH_SECRET`: a long random secret, shared only with Convex.
   - `GOOGLE_CLIENT_ID`: the Google OAuth client ID.
   - `GOOGLE_CLIENT_SECRET`: the Google OAuth client secret.

   For local development, set `SITE_URL=http://localhost:3000` in the Convex environment. Keep `BETTER_AUTH_SECRET` and the Google values out of source control.

3. In Google Cloud Console, create or select a project, configure the OAuth consent screen, and create an OAuth client of type **Web application**. Add this authorized redirect URI:

   `https://<your-convex-deployment>.convex.site/api/auth/callback/google`

   Use the exact Convex site URL for the deployment; do not add a trailing path or substitute the Next.js site URL. Copy the client ID and secret into the Convex environment variables above.

4. Start the web app locally:

   ```text
   cd web
   npm install
   npm run dev
   ```

   The local site is normally `http://localhost:3000`. The Convex deployment must already have the environment variables and generated functions from step 1.

5. In Codeler settings, set `codeler.siteUrl` to the web URL (`http://localhost:3000` locally) and `codeler.convexUrl` to the deployment cloud URL (`https://<your-convex-deployment>.convex.cloud`). Do not put secrets or tokens in either setting.

6. In Codeler, choose **Sign in with Google**. The app opens the device page. Sign in with Google, confirm that the code in the browser matches the code in Codeler, and choose **Allow**. Return to Codeler and confirm that the account appears as signed in.

7. If sign-in fails, check the browser redirect URI, `SITE_URL`, the two Convex URLs, and the Convex deployment logs. A device code expires after ten minutes; start a new sign-in attempt rather than reusing it.
