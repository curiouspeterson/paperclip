import { describe, expect, it } from "vitest";
import {
  applyAgentSkillSnapshot,
  findGovernedHermesSkillForImportSource,
  getGovernableUnmanagedSkillImportSource,
  isReadOnlyUnmanagedSkillEntry,
} from "./agent-skills-state";

describe("applyAgentSkillSnapshot", () => {
  it("hydrates the initial snapshot without arming autosave", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: [],
        lastSaved: [],
        hasHydratedSnapshot: false,
      },
      ["paperclip", "para-memory-files"],
    );

    expect(result).toEqual({
      draft: ["paperclip", "para-memory-files"],
      lastSaved: ["paperclip", "para-memory-files"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("keeps unsaved local edits when a fresh snapshot arrives", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["paperclip", "custom-skill"],
        lastSaved: ["paperclip"],
        hasHydratedSnapshot: true,
      },
      ["paperclip"],
    );

    expect(result).toEqual({
      draft: ["paperclip", "custom-skill"],
      lastSaved: ["paperclip"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: false,
    });
  });

  it("adopts server state after a successful save and skips the follow-up autosave pass", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["paperclip", "custom-skill"],
        lastSaved: ["paperclip", "custom-skill"],
        hasHydratedSnapshot: true,
      },
      ["paperclip", "custom-skill"],
    );

    expect(result).toEqual({
      draft: ["paperclip", "custom-skill"],
      lastSaved: ["paperclip", "custom-skill"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("treats user-installed entries outside the company library as read-only unmanaged skills", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "crack-python",
      runtimeName: "crack-python",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
    }, new Set(["paperclip"]))).toBe(true);
  });

  it("keeps company-library entries in the managed section even when the adapter reports an external conflict", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "paperclip",
      runtimeName: "paperclip",
      desired: true,
      managed: false,
      state: "external",
      origin: "company_managed",
    }, new Set(["paperclip"]))).toBe(false);
  });

  it("falls back to legacy snapshots that only mark unmanaged external entries", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "legacy-external",
      runtimeName: "legacy-external",
      desired: false,
      managed: false,
      state: "external",
    }, new Set())).toBe(true);
  });

  it("derives a governable import source for Hermes-authored unmanaged skills", () => {
    expect(getGovernableUnmanagedSkillImportSource("hermes_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: "/tmp/.hermes/skills/story-weaver",
    })).toBe("/tmp/.hermes/skills/story-weaver");
  });

  it("does not offer governed import for unmanaged skills without a stable local source", () => {
    expect(getGovernableUnmanagedSkillImportSource("hermes_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: null,
    })).toBeNull();

    expect(getGovernableUnmanagedSkillImportSource("codex_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: "/tmp/.hermes/skills/story-weaver",
    })).toBeNull();
  });

  it("matches an imported company skill back to its Hermes source directory", () => {
    expect(findGovernedHermesSkillForImportSource("hermes_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: "/tmp/.hermes/skills/story-weaver/",
    }, [
      {
        id: "skill-1",
        companyId: "company-1",
        key: "company/company-1/story-weaver",
        slug: "story-weaver",
        name: "Story Weaver",
        description: null,
        sourceType: "local_path",
        sourceLocator: "/tmp/.hermes/skills/story-weaver",
        sourceRef: null,
        trustLevel: "markdown_only",
        compatibility: "compatible",
        fileInventory: [],
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T00:00:00Z"),
        attachedAgentCount: 0,
        editable: true,
        editableReason: null,
        sourceLabel: null,
        sourceBadge: "local",
        sourcePath: "/tmp/.hermes/skills/story-weaver",
        importedFromSourcePath: null,
      },
    ])?.id).toBe("skill-1");
  });

  it("does not match unrelated company skills when the Hermes source differs", () => {
    expect(findGovernedHermesSkillForImportSource("hermes_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: "/tmp/.hermes/skills/story-weaver",
    }, [
      {
        id: "skill-1",
        companyId: "company-1",
        key: "company/company-1/story-weaver",
        slug: "story-weaver",
        name: "Story Weaver",
        description: null,
        sourceType: "local_path",
        sourceLocator: "/tmp/company-skills/story-weaver",
        sourceRef: null,
        trustLevel: "markdown_only",
        compatibility: "compatible",
        fileInventory: [],
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T00:00:00Z"),
        attachedAgentCount: 0,
        editable: true,
        editableReason: null,
        sourceLabel: null,
        sourceBadge: "local",
        sourcePath: "/tmp/company-skills/story-weaver",
        importedFromSourcePath: null,
      },
    ])).toBeNull();
  });

  it("matches imported managed copies by their original Hermes source path", () => {
    expect(findGovernedHermesSkillForImportSource("hermes_local", {
      key: "story-weaver",
      runtimeName: "story-weaver",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
      targetPath: "/tmp/.hermes/skills/story-weaver",
    }, [
      {
        id: "skill-1",
        companyId: "company-1",
        key: "local/hash/story-weaver",
        slug: "story-weaver",
        name: "Story Weaver",
        description: null,
        sourceType: "local_path",
        sourceLocator: "/tmp/paperclip/managed/story-weaver",
        sourceRef: null,
        trustLevel: "markdown_only",
        compatibility: "compatible",
        fileInventory: [],
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T00:00:00Z"),
        attachedAgentCount: 0,
        editable: true,
        editableReason: null,
        sourceLabel: null,
        sourceBadge: "paperclip",
        sourcePath: "/tmp/paperclip/managed",
        importedFromSourcePath: "/tmp/.hermes/skills/story-weaver/",
      },
    ])?.id).toBe("skill-1");
  });
});
