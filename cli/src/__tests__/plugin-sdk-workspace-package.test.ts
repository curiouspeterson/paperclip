import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = path.resolve(import.meta.dirname, "../../../packages/plugins/sdk/package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
  exports: Record<string, unknown>;
  publishConfig: {
    exports: Record<string, { import?: string; types?: string }>;
  };
};

describe("@paperclipai/plugin-sdk workspace package contract", () => {
  it("uses source exports in the workspace and dist exports only for publishConfig", () => {
    expect(packageJson.exports["."]).toBe("./src/index.ts");
    expect(packageJson.exports["./protocol"]).toBe("./src/protocol.ts");
    expect(packageJson.exports["./types"]).toBe("./src/types.ts");
    expect(packageJson.exports["./ui"]).toBe("./src/ui/index.ts");
    expect(packageJson.exports["./ui/hooks"]).toBe("./src/ui/hooks.ts");
    expect(packageJson.exports["./ui/types"]).toBe("./src/ui/types.ts");
    expect(packageJson.exports["./testing"]).toBe("./src/testing.ts");
    expect(packageJson.exports["./bundlers"]).toBe("./src/bundlers.ts");
    expect(packageJson.exports["./dev-server"]).toBe("./src/dev-server.ts");

    expect(packageJson.publishConfig.exports["."].import).toBe("./dist/index.js");
    expect(packageJson.publishConfig.exports["./ui"].import).toBe("./dist/ui/index.js");
    expect(packageJson.publishConfig.exports["./testing"].import).toBe("./dist/testing.js");
  });
});
