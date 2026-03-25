import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("podcast workflow wrapper entrypoints", () => {
  it("routes python wrappers through the root bin directory", () => {
    const genericHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "podcast-workflows", "_pipeline_python_entrypoint.py"),
      "utf8",
    );
    const legacyHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "romance-unzipped", "_pipeline_python_entrypoint.py"),
      "utf8",
    );

    expect(genericHelper).toContain('target = repo_root / "bin" / wrapper_name');
    expect(legacyHelper).toContain('target = repo_root / "bin" / wrapper_name');
  });

  it("routes node wrappers through the root bin directory", () => {
    const genericHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "podcast-workflows", "_pipeline_node_entrypoint.mjs"),
      "utf8",
    );
    const legacyHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "romance-unzipped", "_pipeline_node_entrypoint.mjs"),
      "utf8",
    );

    expect(genericHelper).toContain('const target = path.join(repoRoot, "bin", wrapperName);');
    expect(legacyHelper).toContain('const target = path.join(repoRoot, "bin", wrapperName);');
  });
});
