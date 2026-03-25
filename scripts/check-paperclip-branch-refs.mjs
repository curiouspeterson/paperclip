#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path, { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MONITORED_GUIDANCE_TARGETS = [
  "AGENTS.md",
  "doc",
  "docs",
  ".github",
  "ui/src/components/ProjectProperties.tsx",
];

export const FORBIDDEN_PAPERCLIP_BRANCH_REFS = ["origin/main", "upstream/main"];

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function shouldScanFile(absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (extension) return TEXT_FILE_EXTENSIONS.has(extension);

  const basename = path.basename(absolutePath);
  return basename === "AGENTS.md" || basename === "CODEOWNERS";
}

function collectFiles(absolutePath, files) {
  if (!existsSync(absolutePath)) return;

  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolutePath)) {
      collectFiles(path.join(absolutePath, entry), files);
    }
    return;
  }

  if (stats.isFile() && shouldScanFile(absolutePath)) {
    files.push(absolutePath);
  }
}

export function listMonitoredGuidanceFiles({
  repoRoot,
  targets = MONITORED_GUIDANCE_TARGETS,
} = {}) {
  const files = [];
  for (const target of targets) {
    collectFiles(path.resolve(repoRoot, target), files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function findPaperclipBranchRefDrift({
  repoRoot,
  targets = MONITORED_GUIDANCE_TARGETS,
} = {}) {
  const findings = [];

  for (const absolutePath of listMonitoredGuidanceFiles({ repoRoot, targets })) {
    const relativePath = relative(repoRoot, absolutePath) || path.basename(absolutePath);
    const lines = readFileSync(absolutePath, "utf8").split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      for (const ref of FORBIDDEN_PAPERCLIP_BRANCH_REFS) {
        if (line.includes(ref)) {
          findings.push({
            file: relativePath,
            line: index + 1,
            ref,
            text: line.trim(),
          });
        }
      }
    }
  }

  return findings;
}

export function runPaperclipBranchRefCheck({
  repoRoot,
  targets = MONITORED_GUIDANCE_TARGETS,
  log = console.log,
  error = console.error,
} = {}) {
  const findings = findPaperclipBranchRefDrift({ repoRoot, targets });

  if (findings.length === 0) {
    log("  ✓  No stale Paperclip main-branch refs found in monitored guidance surfaces.");
    return 0;
  }

  error("ERROR: Paperclip branch guidance drift detected:\n");
  for (const finding of findings) {
    error(`  ${finding.file}:${finding.line}: found ${finding.ref}`);
  }
  error("\nUse upstream/master or origin/master in Paperclip guidance and automation surfaces.");
  return 1;
}

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function main() {
  process.exit(runPaperclipBranchRefCheck({ repoRoot: REPO_ROOT }));
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
