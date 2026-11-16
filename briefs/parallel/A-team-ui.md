# Parallel job A: connect the Team UI to the team backend
Read briefs/chatgpt.md and the review sections at the end of briefs/chatgpt-log.md first (rules apply).
Backend already exists (Claude's, keep its behaviour): web/convex/teams.ts (mine, people, approve, deny, remove, setRole, invite, deleteTeam) and web/convex/teamsNode.ts (createTeam, requestJoin, changePassword actions).

Build, in extensions/codeler:
1. Create team page (media/team.html): on Create team, post {name, description, password, invites} to the extension; the extension calls teamsNode:createTeam (Auth.convexToken + ConvexHttpClient from 'convex/browser'); afterwards show the owner the join code with a Copy button; show server errors inline. Signed out: the button reads "Sign in to create a team" and runs codeler.signIn. Team avatar upload: skip for now (keep the picker UI; note it in the log).
2. Join a team: command codeler.joinTeam (input boxes for code and password) -> teamsNode:requestJoin; then "Request sent. You can start once an owner or admin approves you."
3. Workspaces panel (media/workspaces.html): real data from teams:mine when signed in (teams, projects, role, waiting count, join code for owner/admin). Clicking a project sets codeler.projectId (workspace setting) and restarts sync/presence. Keep the sample data when signed out.
4. Approvals: in Collaborators (media/collaborators.html), owners/admins see a "Waiting to join" list with Approve / Deny (teams:approve / teams:deny), and Remove per member with a confirm.
5. Title bar: show the real project name when a project is active.

Allowed: media/team.html, workspaces.html, collaborators.html, codeler.js, new files in src/teams/, and only the needed lines in src/extension.ts (createTeam/pickProject handlers plus one registration line). Do not touch src/sync, src/presence, src/history, src/run, web/.

Verify: pure-logic tests in src/teams/*.test.ts (node --test); type-check (--module esnext --moduleResolution bundler); scripts/sync-extension.sh, then transpile, then stub-load out/teams/*.js (stub needs window, workspace, commands, Disposable, EventEmitter). Commit on your branch. Log in briefs/chatgpt-log.md.
