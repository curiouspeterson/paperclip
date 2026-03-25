import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listHermesSkills,
  replaceHermesExternalSkill,
  syncHermesSkills,
} from "../adapters/hermes-local/skills.js";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSkillDir(root: string, name: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return skillDir;
}

describe("hermes local skill sync", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Paperclip skills and installs them into the Hermes skills home", async () => {
    const hermesHome = await makeTempDir("paperclip-hermes-skill-sync-");
    cleanupDirs.add(hermesHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    const before = await listHermesSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("missing");

    const after = await syncHermesSkills(ctx, [paperclipKey]);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(hermesHome, "skills", "paperclip"))).isSymbolicLink()).toBe(true);
  });

  it("shows user-installed Hermes skills as read-only external entries", async () => {
    const hermesHome = await makeTempDir("paperclip-hermes-user-skills-");
    cleanupDirs.add(hermesHome);
    await createSkillDir(path.join(hermesHome, "skills"), "story-weaver");

    const snapshot = await listHermesSkills({
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
      },
    });

    expect(snapshot.entries).toContainEqual(expect.objectContaining({
      key: "story-weaver",
      runtimeName: "story-weaver",
      state: "external",
      managed: false,
      origin: "user_installed",
      originLabel: "User-installed",
      locationLabel: "~/.hermes/skills",
      readOnly: true,
      detail: "Installed outside Paperclip management in the Hermes skills home.",
    }));
  });

  it("keeps required bundled Paperclip skills installed even when the desired set is emptied", async () => {
    const hermesHome = await makeTempDir("paperclip-hermes-skill-prune-");
    cleanupDirs.add(hermesHome);

    const configuredCtx = {
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    await syncHermesSkills(configuredCtx, [paperclipKey]);

    const clearedCtx = {
      ...configuredCtx,
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        paperclipSkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncHermesSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(paperclipKey);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(hermesHome, "skills", "paperclip"))).isSymbolicLink()).toBe(true);
  });

  it("replaces a matching external Hermes skill with the managed Paperclip copy", async () => {
    const hermesHome = await makeTempDir("paperclip-hermes-skill-replace-");
    const runtimeSkills = await makeTempDir("paperclip-hermes-runtime-skills-src-");
    cleanupDirs.add(hermesHome);
    cleanupDirs.add(runtimeSkills);

    const managedDir = await createSkillDir(runtimeSkills, "story-weaver--abc123");
    const externalDir = await createSkillDir(path.join(hermesHome, "external-src"), "story-weaver");
    const skillsHome = path.join(hermesHome, "skills");
    await fs.mkdir(skillsHome, { recursive: true });
    await fs.rename(externalDir, path.join(skillsHome, "story-weaver"));

    const ctx = {
      agentId: "agent-4",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        paperclipRuntimeSkills: [
          {
            key: "company/company-1/story-weaver",
            runtimeName: "story-weaver",
            source: managedDir,
          },
        ],
        paperclipSkillSync: {
          desiredSkills: ["company/company-1/story-weaver"],
        },
      },
    } as const;

    const snapshot = await replaceHermesExternalSkill(ctx, {
      desiredSkillKey: "company/company-1/story-weaver",
      runtimeName: "story-weaver",
      expectedExternalSourcePath: path.join(skillsHome, "story-weaver"),
    });

    expect(snapshot.mode).toBe("persistent");
    expect((await fs.lstat(path.join(skillsHome, "story-weaver"))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(skillsHome, "story-weaver"))).toBe(managedDir);
  });

  it("reports imported-source conflicts explicitly when Hermes is still using the original external copy", async () => {
    const hermesHome = await makeTempDir("paperclip-hermes-imported-conflict-");
    cleanupDirs.add(hermesHome);
    await createSkillDir(path.join(hermesHome, "skills"), "story-weaver");

    const snapshot = await listHermesSkills({
      agentId: "agent-5",
      companyId: "company-1",
      adapterType: "hermes_local",
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        paperclipRuntimeSkills: [
          {
            key: "company/company-1/story-weaver",
            runtimeName: "story-weaver",
            source: "/tmp/paperclip-managed/story-weaver",
            importedFromSourcePath: path.join(hermesHome, "skills", "story-weaver"),
          },
        ],
        paperclipSkillSync: {
          desiredSkills: ["company/company-1/story-weaver"],
        },
      },
    });

    expect(snapshot.entries).toContainEqual(expect.objectContaining({
      key: "company/company-1/story-weaver",
      runtimeName: "story-weaver",
      state: "external",
      externalConflictKind: "imported_source",
      externalConflictPath: path.join(hermesHome, "skills", "story-weaver"),
    }));
  });
});
