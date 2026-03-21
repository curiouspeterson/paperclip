import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "../adapters/process/execute.js";

async function writeFakeProcessCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const payload = {
  cwd: process.cwd(),
  workspaceCwd: process.env.PAPERCLIP_WORKSPACE_CWD || null,
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ _usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  cwd: string;
  workspaceCwd: string | null;
  paperclipEnvKeys: string[];
};

describe("process adapter execute", () => {
  it("injects the workspace cwd for child process workers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-process-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "worker");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeProcessCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Process Worker",
          adapterType: "process",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const expectedWorkspace = await fs.realpath(workspace);
      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(await fs.realpath(capture.cwd)).toBe(expectedWorkspace);
      expect(await fs.realpath(capture.workspaceCwd!)).toBe(expectedWorkspace);
      expect(capture.paperclipEnvKeys).toEqual(
        expect.arrayContaining([
          "PAPERCLIP_AGENT_ID",
          "PAPERCLIP_API_KEY",
          "PAPERCLIP_API_URL",
          "PAPERCLIP_COMPANY_ID",
          "PAPERCLIP_RUN_ID",
          "PAPERCLIP_WORKSPACE_CWD",
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
