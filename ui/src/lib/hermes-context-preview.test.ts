import { describe, expect, it } from "vitest";
import {
  buildEffectiveHermesContextPreview,
  buildHermesEffectiveContextDiff,
  buildHermesContextArchiveFiles,
  buildHermesContextBundleText,
  buildHermesContextPreview,
  buildHermesContextPreviewState,
} from "./hermes-context-preview";

describe("buildHermesContextPreview", () => {
  it("returns no docs when the profile is empty", () => {
    expect(buildHermesContextPreview({})).toEqual([]);
  });

  it("builds SOUL.md and AGENTS.md from company profile fields", () => {
    const docs = buildHermesContextPreview({
      companyName: "Paper Trail Weekly",
      voiceDescription: "Warm, candid, and insight-heavy.",
      targetAudience: "Romance readers who like sharp emotional analysis.",
      defaultChannel: "Newsletter",
      defaultGoal: "Get readers to listen and reply.",
      voiceExamplesRight: ["Sample right"],
      voiceExamplesWrong: ["Sample wrong"],
    });

    expect(docs.map((doc) => doc.key)).toEqual(["SOUL.md", "AGENTS.md"]);
    expect(docs[0]?.content).toContain("Company: Paper Trail Weekly");
    expect(docs[0]?.content).toContain("## How We Describe Our Voice");
    expect(docs[0]?.content).toContain("1. Sample right");
    expect(docs[1]?.content).toContain("## Audience");
    expect(docs[1]?.content).toContain("## Goal");
    expect(docs[1]?.content).toContain("1. Sample wrong");
  });

  it("includes USER.md and MEMORY.md when memory seeding is enabled", () => {
    const docs = buildHermesContextPreview(
      {
        companyName: "Paper Trail Weekly",
        targetAudience: "Readers",
        defaultChannel: "Instagram",
        defaultGoal: "Drive replies",
        voiceDescription: "Direct and generous.",
      },
      { includeMemoryDocs: true },
    );

    expect(docs.map((doc) => doc.key)).toEqual([
      "SOUL.md",
      "AGENTS.md",
      "USER.md",
      "MEMORY.md",
    ]);
    expect(docs[2]?.content).toContain("# USER.md -- Working Audience");
    expect(docs[2]?.content).toContain("## Default Channel");
    expect(docs[3]?.content).toContain("# MEMORY.md -- Seeded Company Memory");
    expect(docs[3]?.content).toContain("## Voice");
  });

  it("builds a copyable bundle and archive file map", () => {
    const docs = buildHermesContextPreview(
      {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
      },
      { includeMemoryDocs: true },
    );

    expect(buildHermesContextBundleText(docs)).toContain("SOUL.md\n=======");
    expect(buildHermesContextBundleText(docs)).toContain("MEMORY.md\n=========");
    expect(buildHermesContextArchiveFiles(docs)).toMatchObject({
      "SOUL.md": expect.stringContaining("# SOUL.md -- Company Voice"),
      "AGENTS.md": expect.stringContaining("# AGENTS.md -- Company Prompt Packet"),
      "USER.md": expect.stringContaining("# USER.md -- Working Audience"),
      "MEMORY.md": expect.stringContaining("# MEMORY.md -- Seeded Company Memory"),
    });
  });

  it("describes whether the preview reflects saved data or unsaved edits", () => {
    expect(buildHermesContextPreviewState(false)).toEqual({
      label: "Using saved company profile",
      description:
        "The generated Hermes files below match the last saved company profile and current Hermes policy defaults.",
    });
    expect(buildHermesContextPreviewState(true)).toEqual({
      label: "Previewing unsaved edits",
      description:
        "The generated Hermes files below reflect the form changes on this page, not just the last saved company profile.",
    });
  });

  it("derives effective Hermes context docs from agent config and company defaults", () => {
    const preview = buildEffectiveHermesContextPreview({
      profile: {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
        targetAudience: "Readers",
      },
      agentConfig: {
        paperclipManagedHermesHome: true,
      },
      companyDefaults: {
        agentDefaultHermesManagedHome: false,
        agentDefaultHermesSeedCompanyProfileMemory: true,
      },
    });

    expect(preview).toMatchObject({
      managedHome: true,
      companyProfileMemorySeeded: true,
      policySources: {
        managedHome: "agent_override",
        companyProfileMemorySeeded: "company_default",
      },
    });
    expect(preview.docs.map((doc) => doc.key)).toEqual([
      "SOUL.md",
      "AGENTS.md",
      "USER.md",
      "MEMORY.md",
    ]);
  });

  it("suppresses docs when the effective agent policy does not use a managed Hermes home", () => {
    const preview = buildEffectiveHermesContextPreview({
      profile: {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
      },
      agentConfig: {},
      companyDefaults: {
        agentDefaultHermesManagedHome: false,
        agentDefaultHermesSeedCompanyProfileMemory: true,
      },
    });

    expect(preview).toEqual({
      managedHome: false,
      companyProfileMemorySeeded: true,
      policySources: {
        managedHome: "company_default",
        companyProfileMemorySeeded: "company_default",
      },
      docs: [],
    });
  });

  it("reports no diff when the agent inherits the company Hermes context policy", () => {
    const diff = buildHermesEffectiveContextDiff({
      profile: {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
      },
      agentConfig: {},
      companyDefaults: {
        agentDefaultHermesManagedHome: true,
        agentDefaultHermesSeedCompanyProfileMemory: false,
      },
    });

    expect(diff.matchesCompanyDefaults).toBe(true);
    expect(diff.entries).toEqual([]);
  });

  it("reports a managed-home override when the agent disables managed Hermes context files", () => {
    const diff = buildHermesEffectiveContextDiff({
      profile: {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
      },
      agentConfig: {
        paperclipManagedHermesHome: false,
      },
      companyDefaults: {
        agentDefaultHermesManagedHome: true,
        agentDefaultHermesSeedCompanyProfileMemory: false,
      },
    });

    expect(diff.matchesCompanyDefaults).toBe(false);
    expect(diff.entries).toEqual([
      expect.objectContaining({
        key: "managedHome",
        affectedDocs: ["SOUL.md", "AGENTS.md"],
      }),
    ]);
  });

  it("reports memory-doc deltas when the agent enables company profile memory seeding", () => {
    const diff = buildHermesEffectiveContextDiff({
      profile: {
        companyName: "Paper Trail Weekly",
        voiceDescription: "Warm and candid.",
        targetAudience: "Readers",
      },
      agentConfig: {
        paperclipManagedHermesHome: true,
        paperclipSeedCompanyProfileMemory: true,
      },
      companyDefaults: {
        agentDefaultHermesManagedHome: true,
        agentDefaultHermesSeedCompanyProfileMemory: false,
      },
    });

    expect(diff.matchesCompanyDefaults).toBe(false);
    expect(diff.entries).toEqual([
      expect.objectContaining({
        key: "memorySeeding",
        affectedDocs: ["USER.md", "MEMORY.md"],
      }),
    ]);
  });
});
