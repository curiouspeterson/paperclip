import { describe, expect, it, vi } from "vitest";
import { cleanupStaleSysvSharedMemorySegments } from "./test-embedded-postgres.js";

describe("cleanupStaleSysvSharedMemorySegments", () => {
  it("removes only current-user shared memory segments whose owning processes are gone", async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file !== "ipcs") {
        throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
      }

      if (args.join(" ") === "-m -p") {
        return {
          stdout: `IPC status from <running system>
T     ID     KEY        MODE       OWNER    GROUP  CPID  LPID
Shared Memory:
m  65536 0x013f23df --rw------- adampeterson    staff   1933   1933
m 3604481 0x0fc6fc3c --rw------- adampeterson    staff  78098  78098
m 327682 0x0fc1a38d --rw------- someoneelse    staff  70000  70000
m 16318478 0x0f32335d --rw------- adampeterson    staff  45207  45207
`,
          stderr: "",
        };
      }

      throw new Error(`unexpected args: ${args.join(" ")}`);
    });
    const removed: number[] = [];

    const count = await cleanupStaleSysvSharedMemorySegments({
      currentUser: "adampeterson",
      execFile,
      isPidAlive: (pid) => pid === 1933 || pid === 45207,
      removeSegment: async (id) => {
        removed.push(id);
      },
    });

    expect(count).toBe(1);
    expect(removed).toEqual([3604481]);
  });

  it("does nothing when the IPC table is unavailable", async () => {
    const execFile = vi.fn(async () => {
      const error = new Error("command not found") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    });

    const count = await cleanupStaleSysvSharedMemorySegments({
      currentUser: "adampeterson",
      execFile,
      isPidAlive: () => false,
      removeSegment: async () => {
        throw new Error("should not remove anything");
      },
    });

    expect(count).toBe(0);
  });
});
