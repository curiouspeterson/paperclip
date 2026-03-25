import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CHECKER_MODULE_URL = new URL("../../../scripts/check-paperclip-branch-refs.mjs", import.meta.url);

async function loadChecker() {
  return import(CHECKER_MODULE_URL.href);
}

function writeRepoFile(repoRoot: string, relativePath: string, contents: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-branch-guidance-"));
  tempDirs.push(repoRoot);
  return repoRoot;
}

describe("paperclip branch guidance check", () => {
  it("flags stale main-branch refs in monitored guidance surfaces", async () => {
    const repoRoot = createTempRepoRoot();
    writeRepoFile(repoRoot, "AGENTS.md", "Sync from upstream/main before branching.\n");
    writeRepoFile(repoRoot, "doc/guide.md", "Use origin/main for Paperclip worktrees.\n");

    const { findPaperclipBranchRefDrift } = await loadChecker();
    const findings = findPaperclipBranchRefDrift({ repoRoot });

    expect(findings).toEqual([
      expect.objectContaining({ file: "AGENTS.md", line: 1, ref: "upstream/main" }),
      expect.objectContaining({ file: path.join("doc", "guide.md"), line: 1, ref: "origin/main" }),
    ]);
  });

  it("ignores stale refs outside the monitored guidance surfaces", async () => {
    const repoRoot = createTempRepoRoot();
    writeRepoFile(repoRoot, "server/src/example.ts", "const baseRef = \"origin/main\";\n");

    const { findPaperclipBranchRefDrift } = await loadChecker();
    expect(findPaperclipBranchRefDrift({ repoRoot })).toEqual([]);
  });

  it("keeps the real repo guidance surfaces free of stale main-branch refs", async () => {
    const { findPaperclipBranchRefDrift } = await loadChecker();
    expect(findPaperclipBranchRefDrift({ repoRoot: REPO_ROOT })).toEqual([]);
  });
});
