import { describe, expect, it } from "vitest";
import { restoreProcessEnv } from "./env-test-helpers.js";

describe("restoreProcessEnv", () => {
  it("restores env values without replacing the process.env object", () => {
    const envRef = process.env;
    const originalKey = process.env.PAPERCLIP_TEST_RESTORE_ORIGINAL;
    const extraKey = "PAPERCLIP_TEST_RESTORE_EXTRA";
    const originalExtra = process.env[extraKey];
    const snapshot = {
      ...process.env,
      PAPERCLIP_TEST_RESTORE_ORIGINAL: "snapshot-value",
    };

    process.env.PAPERCLIP_TEST_RESTORE_ORIGINAL = "mutated-value";
    process.env[extraKey] = "extra-value";

    restoreProcessEnv(snapshot);

    expect(process.env).toBe(envRef);
    expect(process.env.PAPERCLIP_TEST_RESTORE_ORIGINAL).toBe("snapshot-value");
    expect(process.env[extraKey]).toBeUndefined();

    if (originalKey === undefined) delete process.env.PAPERCLIP_TEST_RESTORE_ORIGINAL;
    else process.env.PAPERCLIP_TEST_RESTORE_ORIGINAL = originalKey;

    if (originalExtra === undefined) delete process.env[extraKey];
    else process.env[extraKey] = originalExtra;
  });
});
