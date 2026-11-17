// Shared project path rule for sync and presence. This is the same rule as extensions/codeler/src/sync/safety.ts
// and extensions/codeler/mcp/server.js: keep all three identical. Plain helper, no Convex functions here.

const BLOCKED = new Set(["node_modules", ".git", ".codeler", "dist", "out", ".next"]);
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;

export function isSafeRelativePath(file: string): boolean {
  if (typeof file !== "string" || file.length === 0 || file.length > 500 || /[\u0000-\u001f\u007f]/.test(file)) return false;
  if (file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:/.test(file)) return false;
  return file.replaceAll("\\", "/").split("/").every((seg) => {
    if (!seg || seg === "." || seg === ".." || /[. ]$/.test(seg) || seg.includes(":")) return false;
    if (RESERVED.test(seg.split(".")[0].trim().toUpperCase())) return false;
    return !BLOCKED.has(seg.toLowerCase());
  });
}
