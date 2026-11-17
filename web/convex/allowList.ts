// Who may create a Codeler account. ALLOWED_EMAILS (Convex env var) is a comma-separated list;
// empty or unset means anyone with a Google account may sign up. Existing accounts are never blocked.
export function emailAllowed(email: string, list: string | undefined): boolean {
  const allowed = (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(email.trim().toLowerCase());
}
