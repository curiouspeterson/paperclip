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
  taskId: process.env.PAPERCLIP_TASK_ID || null,
  wakeReason: process.env.PAPERCLIP_WAKE_REASON || null,
  wakeCommentId: process.env.PAPERCLIP_WAKE_COMMENT_ID || null,
  approvalId: process.env.PAPERCLIP_APPROVAL_ID || null,
  approvalStatus: process.env.PAPERCLIP_APPROVAL_STATUS || null,
  agentHome: process.env.AGENT_HOME || null,
  runtimeSessionId: process.env.PAPERCLIP_RUNTIME_SESSION_ID || null,
  runtimeSessionParams: process.env.PAPERCLIP_RUNTIME_SESSION_PARAMS_JSON || null,
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({
  _usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  _sessionId: "hermes-session-1",
  _sessionDisplayId: "paperclip::agent-1::ROM-1",
  _sessionParams: { sessionId: "hermes-session-1", sessionName: "paperclip::agent-1::ROM-1" },
  _paperclipHermesAppliedRuntimePolicy: {
    hermesHome: "/tmp/hermes-home",
    managedHome: true,
    companyProfileMemorySeeded: true,
    toolsets: ["skills", "browser"],
    configuredMcpServerNames: ["github"],
    allowedMcpServerNames: ["github"],
    materializedMcpServerNames: ["github"],
    seededContextFiles: ["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md"]
  }
}));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  cwd: string;
  workspaceCwd: string | null;
  taskId: string | null;
  wakeReason: string | null;
  wakeCommentId: string | null;
  approvalId: string | null;
  approvalStatus: string | null;
  agentHome: string | null;
  runtimeSessionId: string | null;
  runtimeSessionParams: string | null;
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
          sessionId: "session-before",
          sessionParams: { sessionId: "session-before", sessionName: "paperclip::agent-1::ROM-1" },
          sessionDisplayId: "paperclip::agent-1::ROM-1",
          taskKey: "task-1",
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
        },
        context: {
          taskId: "task-1",
          issueId: "issue-1",
          wakeReason: "assignment",
          wakeCommentId: "comment-1",
          approvalId: "approval-1",
          approvalStatus: "approved",
          paperclipWorkspace: {
            cwd: workspace,
            source: "agent_home",
            agentHome: path.join(root, "agent-home"),
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(result.sessionId).toBe("hermes-session-1");
      expect(result.sessionDisplayId).toBe("paperclip::agent-1::ROM-1");
      expect(result.sessionParams).toEqual({
        sessionId: "hermes-session-1",
        sessionName: "paperclip::agent-1::ROM-1",
      });
      expect(result.resultJson).toMatchObject({
        _paperclipHermesAppliedRuntimePolicy: {
          hermesHome: "/tmp/hermes-home",
          managedHome: true,
          companyProfileMemorySeeded: true,
          toolsets: ["skills", "browser"],
          configuredMcpServerNames: ["github"],
          allowedMcpServerNames: ["github"],
          materializedMcpServerNames: ["github"],
          seededContextFiles: ["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md"],
        },
      });

      const expectedWorkspace = await fs.realpath(workspace);
      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(await fs.realpath(capture.cwd)).toBe(expectedWorkspace);
      expect(await fs.realpath(capture.workspaceCwd!)).toBe(expectedWorkspace);
      expect(capture.taskId).toBe("task-1");
      expect(capture.wakeReason).toBe("assignment");
      expect(capture.wakeCommentId).toBe("comment-1");
      expect(capture.approvalId).toBe("approval-1");
      expect(capture.approvalStatus).toBe("approved");
      expect(capture.agentHome).toBe(path.join(root, "agent-home"));
      expect(capture.runtimeSessionId).toBe("session-before");
      expect(capture.runtimeSessionParams).toBe(
        JSON.stringify({ sessionId: "session-before", sessionName: "paperclip::agent-1::ROM-1" }),
      );
      expect(capture.paperclipEnvKeys).toEqual(
        expect.arrayContaining([
          "PAPERCLIP_AGENT_ID",
          "PAPERCLIP_API_KEY",
          "PAPERCLIP_APPROVAL_ID",
          "PAPERCLIP_APPROVAL_STATUS",
          "PAPERCLIP_API_URL",
          "PAPERCLIP_COMPANY_ID",
          "PAPERCLIP_RUN_ID",
          "PAPERCLIP_RUNTIME_SESSION_ID",
          "PAPERCLIP_RUNTIME_SESSION_PARAMS_JSON",
          "PAPERCLIP_TASK_ID",
          "PAPERCLIP_WAKE_COMMENT_ID",
          "PAPERCLIP_WAKE_REASON",
          "PAPERCLIP_WORKSPACE_CWD",
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
