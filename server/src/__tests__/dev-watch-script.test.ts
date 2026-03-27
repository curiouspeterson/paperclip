import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const devWatchScriptPath = path.resolve(testDir, "../../scripts/dev-watch.ts");

describe("server dev watch launcher", () => {
  it("resolves tsx through the exported cli entrypoint", () => {
    const source = fs.readFileSync(devWatchScriptPath, "utf8");

    expect(source).toContain('require.resolve("tsx/cli")');
    expect(source).not.toContain('require.resolve("tsx/dist/cli.mjs")');
  });
});
