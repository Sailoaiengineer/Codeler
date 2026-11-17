import { describe, expect, it } from "vitest";
import { isSafeRelativePath } from "./projectPath";

// Same cases as extensions/codeler/src/sync/safety.test.ts and extensions/codeler/mcp/server.test.js.
const REFUSED = ["../x", "/x", "\\x", "C:\\x", "C:x", "a\0b", "a\u0001b", "a/../b", ".. ", "..\u0020", "a/.. /b", "a/b.", "a/b ", "x:stream", "CON", "con.txt", "a/NUL.tar.gz", "LPT1", "a/com9.log", ".GIT/hooks/x", "Node_Modules/x", ".Codeler/x", "DIST/a.js", "a//b", "", "\\\\server\\share\\x", "x".repeat(501)];
const ACCEPTED = ["src/app.ts", ".vscode/settings.json", ".github/workflows/a.yml", "src/CONSOLE.md", "a/b.c", "src/.gitignore"];

describe("shared project path rule", () => {
  it("refuses unsafe paths", () => {
    for (const value of REFUSED) expect(isSafeRelativePath(value), JSON.stringify(value)).toBe(false);
  });
  it("accepts normal project paths, including team config folders", () => {
    for (const value of ACCEPTED) expect(isSafeRelativePath(value), value).toBe(true);
  });
});
