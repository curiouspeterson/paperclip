import { describe, expect, it } from "vitest";
import { normalizeVitestScriptArgs } from "../../../scripts/run-vitest-args.mjs";

describe("normalizeVitestScriptArgs", () => {
  it("drops the standalone pnpm separator for run-mode invocations", () => {
    expect(
      normalizeVitestScriptArgs([
        "run",
        "--",
        "src/__tests__/issue-comment-reopen-routes.test.ts",
        "--reporter=verbose",
      ]),
    ).toEqual([
      "run",
      "src/__tests__/issue-comment-reopen-routes.test.ts",
      "--reporter=verbose",
    ]);
  });

  it("drops a leading pnpm separator for plain vitest invocations", () => {
    expect(normalizeVitestScriptArgs(["--", "src/project-mentions.test.ts"])).toEqual([
      "src/project-mentions.test.ts",
    ]);
  });

  it("leaves normal vitest arguments unchanged", () => {
    expect(normalizeVitestScriptArgs(["run", "src/project-mentions.test.ts"])).toEqual([
      "run",
      "src/project-mentions.test.ts",
    ]);
  });
});
