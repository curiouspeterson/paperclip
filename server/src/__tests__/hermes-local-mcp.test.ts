import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHermesAppliedRuntimePolicy,
  materializeHermesMcpConfig,
  resolveHermesManagedHome,
} from "../adapters/hermes-local/mcp.js";

const envSnapshot = {
  PAPERCLIP_HOME: process.env.PAPERCLIP_HOME,
  PAPERCLIP_INSTANCE_ID: process.env.PAPERCLIP_INSTANCE_ID,
};

afterEach(async () => {
  process.env.PAPERCLIP_HOME = envSnapshot.PAPERCLIP_HOME;
  process.env.PAPERCLIP_INSTANCE_ID = envSnapshot.PAPERCLIP_INSTANCE_ID;
});

describe("Hermes MCP materialization", () => {
  it("materializes mcp_servers into a Paperclip-managed Hermes home", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-mcp-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-1",
      },
      config: {
        model: "glm-4.7",
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
          },
        },
      },
    });

    const managedHome = resolveHermesManagedHome("agent-1");
    expect((config.env as Record<string, unknown>).HERMES_HOME).toBe(managedHome);

    const written = await fs.readFile(path.join(managedHome, "config.yaml"), "utf8");
    expect(JSON.parse(written)).toEqual({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    });
  });

  it("uses an explicit HERMES_HOME when one is already configured", async () => {
    const hermesHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-explicit-"));

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-2",
      },
      config: {
        env: {
          HERMES_HOME: hermesHome,
        },
        mcpServers: {
          filesystem: {
            command: "npx",
          },
        },
      },
    });

    expect((config.env as Record<string, unknown>).HERMES_HOME).toBe(hermesHome);
    const written = await fs.readFile(path.join(hermesHome, "config.yaml"), "utf8");
    expect(JSON.parse(written)).toEqual({
      mcp_servers: {
        filesystem: {
          command: "npx",
        },
      },
    });
  });

  it("materializes only the allowed MCP server subset when configured", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-mcp-filter-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-3",
      },
      config: {
        allowedMcpServerNames: ["github"],
        mcpServers: {
          github: {
            command: "npx",
          },
          filesystem: {
            command: "node",
          },
        },
      },
    });

    const managedHome = resolveHermesManagedHome("agent-3");
    expect((config.env as Record<string, unknown>).HERMES_HOME).toBe(managedHome);
    const written = await fs.readFile(path.join(managedHome, "config.yaml"), "utf8");
    expect(JSON.parse(written)).toEqual({
      mcp_servers: {
        github: {
          command: "npx",
        },
      },
    });
  });

  it("creates a Paperclip-managed Hermes home even without MCP servers", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-4",
      },
      config: {
        paperclipManagedHermesHome: true,
      },
    });

    const managedHome = resolveHermesManagedHome("agent-4");
    expect((config.env as Record<string, unknown>).HERMES_HOME).toBe(managedHome);
    await expect(fs.stat(managedHome)).resolves.toBeTruthy();
    await expect(fs.readFile(path.join(managedHome, "config.yaml"), "utf8")).rejects.toThrow();
  });

  it("seeds managed Hermes home context files from the company profile", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-profile-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-5",
      },
      context: {
        paperclipCompanyProfile: {
          companyName: "Romance Unzipped",
          voiceDescription: "Warm, smart, specific, and never generic.",
          targetAudience: "Romance readers who want sharp emotional analysis.",
          defaultChannel: "Newsletter",
          defaultGoal: "Make the reader want to open the episode and forward it to a friend.",
          voiceExamplesRight: [
            "This lands because the chemistry is messy, specific, and embarrassingly human.",
          ],
          voiceExamplesWrong: [
            "A totally unforgettable romance journey you cannot miss!",
          ],
        },
      },
      config: {
        paperclipManagedHermesHome: true,
        paperclipSeedCompanyProfileMemory: true,
      },
    });

    const managedHome = resolveHermesManagedHome("agent-5");
    expect((config.env as Record<string, unknown>).HERMES_HOME).toBe(managedHome);
    await expect(fs.readFile(path.join(managedHome, "SOUL.md"), "utf8")).resolves.toContain("Warm, smart, specific");
    await expect(fs.readFile(path.join(managedHome, "AGENTS.md"), "utf8")).resolves.toContain("## Right Examples");
    await expect(fs.readFile(path.join(managedHome, "USER.md"), "utf8")).resolves.toContain("## Audience");
    await expect(fs.readFile(path.join(managedHome, "MEMORY.md"), "utf8")).resolves.toContain("Seeded from the Paperclip Company Profile");
  });

  it("builds a normalized applied runtime policy from the materialized Hermes config", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-policy-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test";

    const config = await materializeHermesMcpConfig({
      agent: {
        id: "agent-6",
      },
      context: {
        paperclipCompanyProfile: {
          companyName: "Romance Unzipped",
          voiceDescription: "Warm and specific.",
        },
      },
      config: {
        paperclipManagedHermesHome: true,
        paperclipSeedCompanyProfileMemory: true,
        toolsets: "skills,browser",
        allowedMcpServerNames: ["github"],
        mcpServers: {
          github: { command: "npx" },
          filesystem: { command: "node" },
        },
      },
    });

    expect(buildHermesAppliedRuntimePolicy(config, {
      companyName: "Romance Unzipped",
      voiceDescription: "Warm and specific.",
      targetAudience: null,
      defaultChannel: null,
      defaultGoal: null,
      voiceExamplesRight: [],
      voiceExamplesWrong: [],
    })).toEqual({
      hermesHome: resolveHermesManagedHome("agent-6"),
      managedHome: true,
      companyProfileMemorySeeded: true,
      toolsets: ["skills", "browser"],
      configuredMcpServerNames: ["filesystem", "github"],
      allowedMcpServerNames: ["github"],
      materializedMcpServerNames: ["github"],
      seededContextFiles: ["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md"],
    });
  });
});
