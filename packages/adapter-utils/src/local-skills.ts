import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeMaintainerOnlySkillSymlinks } from "./server-utils.js";

// ---------------------------------------------------------------------------
// Tool home directories
// ---------------------------------------------------------------------------

export function codexSkillsHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".codex");
  return path.join(base, "skills");
}

export function claudeSkillsHome(): string {
  const fromEnv = process.env.CLAUDE_HOME?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".claude");
  return path.join(base, "skills");
}

// ---------------------------------------------------------------------------
// Skill install (CLI use)
// ---------------------------------------------------------------------------

export interface SkillsInstallSummary {
  tool: "codex" | "claude";
  target: string;
  linked: string[];
  removed: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

export async function installSkillsForTarget(
  sourceSkillsDir: string,
  targetSkillsDir: string,
  tool: "codex" | "claude",
): Promise<SkillsInstallSummary> {
  const summary: SkillsInstallSummary = {
    tool,
    target: targetSkillsDir,
    linked: [],
    removed: [],
    skipped: [],
    failed: [],
  };

  await fsp.mkdir(targetSkillsDir, { recursive: true });
  const entries = await fsp.readdir(sourceSkillsDir, { withFileTypes: true });
  summary.removed = await removeMaintainerOnlySkillSymlinks(
    targetSkillsDir,
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(sourceSkillsDir, entry.name);
    const target = path.join(targetSkillsDir, entry.name);
    const existing = await fsp.lstat(target).catch(() => null);
    if (existing) {
      if (existing.isSymbolicLink()) {
        let linkedPath: string | null = null;
        try {
          linkedPath = await fsp.readlink(target);
        } catch (err) {
          await fsp.unlink(target);
          try {
            await fsp.symlink(source, target);
            summary.linked.push(entry.name);
            continue;
          } catch (linkErr) {
            summary.failed.push({
              name: entry.name,
              error:
                err instanceof Error && linkErr instanceof Error
                  ? `${err.message}; then ${linkErr.message}`
                  : err instanceof Error
                  ? err.message
                  : `Failed to recover broken symlink: ${String(err)}`,
            });
            continue;
          }
        }

        const resolvedLinkedPath = path.isAbsolute(linkedPath)
          ? linkedPath
          : path.resolve(path.dirname(target), linkedPath);
        const linkedTargetExists = await fsp
          .stat(resolvedLinkedPath)
          .then(() => true)
          .catch(() => false);

        if (!linkedTargetExists) {
          await fsp.unlink(target);
        } else {
          summary.skipped.push(entry.name);
          continue;
        }
      } else {
        summary.skipped.push(entry.name);
        continue;
      }
    }

    try {
      await fsp.symlink(source, target);
      summary.linked.push(entry.name);
    } catch (err) {
      summary.failed.push({
        name: entry.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Skill catalog (server use)
// ---------------------------------------------------------------------------

/** Parse YAML frontmatter from a SKILL.md file to extract the description. */
export function parseSkillFrontmatter(markdown: string): { description: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: "" };
  const yaml = match[1];
  const descMatch = yaml.match(
    /^description:\s*(?:>\s*\n((?:\s{2,}[^\n]*\n?)+)|[|]\s*\n((?:\s{2,}[^\n]*\n?)+)|["']?(.*?)["']?\s*$)/m,
  );
  if (!descMatch) return { description: "" };
  const raw = descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? "";
  return {
    description: raw
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim(),
  };
}

const ALLOWED_SKILL_NAMES = new Set([
  "paperclip",
  "paperclip-create-agent",
  "paperclip-create-plugin",
  "para-memory-files",
]);

/**
 * Read a built-in Paperclip skill's SKILL.md.
 * Pass the calling module's `import.meta.url` as `callerModuleUrl` so the
 * function can resolve paths relative to the server package.
 */
export function readSkillMarkdown(skillName: string, callerModuleUrl: string): string | null {
  const normalized = skillName.trim().toLowerCase();
  if (!ALLOWED_SKILL_NAMES.has(normalized)) return null;
  const moduleDir = path.dirname(fileURLToPath(callerModuleUrl));
  const candidates = [
    path.resolve(moduleDir, "../../skills", normalized, "SKILL.md"),
    path.resolve(process.cwd(), "skills", normalized, "SKILL.md"),
    path.resolve(moduleDir, "../../../skills", normalized, "SKILL.md"),
  ];
  for (const skillPath of candidates) {
    try {
      return fs.readFileSync(skillPath, "utf8");
    } catch {
      // Continue to next candidate.
    }
  }
  return null;
}

/** Resolve the Paperclip repo skills directory (built-in / managed skills). */
export function resolvePaperclipSkillsDirSync(callerModuleUrl: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(callerModuleUrl));
  const candidates = [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(moduleDir, "../../../skills"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}

export interface AvailableSkill {
  name: string;
  description: string;
  isPaperclipManaged: boolean;
}

/** Discover all available Claude Code skills from ~/.claude/skills/. */
export function listAvailableSkills(callerModuleUrl: string): AvailableSkill[] {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const claudeSkillsDir = path.join(homeDir, ".claude", "skills");
  const paperclipSkillsDir = resolvePaperclipSkillsDirSync(callerModuleUrl);

  const paperclipSkillNames = new Set<string>();
  if (paperclipSkillsDir) {
    try {
      for (const entry of fs.readdirSync(paperclipSkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) paperclipSkillNames.add(entry.name);
      }
    } catch {
      /* skip */
    }
  }

  const skills: AvailableSkill[] = [];
  try {
    const entries = fs.readdirSync(claudeSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      const skillMdPath = path.join(claudeSkillsDir, entry.name, "SKILL.md");
      let description = "";
      try {
        const md = fs.readFileSync(skillMdPath, "utf8");
        description = parseSkillFrontmatter(md).description;
      } catch {
        /* no SKILL.md or unreadable */
      }
      skills.push({
        name: entry.name,
        description,
        isPaperclipManaged: paperclipSkillNames.has(entry.name),
      });
    }
  } catch {
    /* ~/.claude/skills/ doesn't exist */
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}
