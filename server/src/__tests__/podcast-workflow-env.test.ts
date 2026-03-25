import { describe, expect, it } from "vitest";
import {
  resolvePodcastWorkflowDefaultChannelUrl,
  resolvePodcastWorkflowPythonBin,
} from "../services/podcast-workflow-env.ts";

describe("podcast workflow env helpers", () => {
  it("prefers generic env overrides over legacy podcast fallbacks", () => {
    const env = {
      PAPERCLIP_PODCAST_DEFAULT_CHANNEL_URL: "https://example.com/generic-channel",
      RU_YOUTUBE_CHANNEL_URL: "https://example.com/legacy-channel",
      PAPERCLIP_PYTHON_BIN: "/opt/generic/python3",
      RU_PYTHON_BIN: "/opt/legacy/python3",
      PYTHON_BIN: "/opt/fallback/python3",
    } as NodeJS.ProcessEnv;

    expect(resolvePodcastWorkflowDefaultChannelUrl(env)).toBe("https://example.com/generic-channel");
    expect(resolvePodcastWorkflowPythonBin(env)).toBe("/opt/generic/python3");
  });

  it("uses legacy podcast env names when generic overrides are not set", () => {
    const env = {
      RU_YOUTUBE_CHANNEL_URL: "https://example.com/legacy-channel",
      RU_PYTHON_BIN: "/opt/legacy/python3",
      PYTHON_BIN: "/opt/fallback/python3",
    } as NodeJS.ProcessEnv;

    expect(resolvePodcastWorkflowDefaultChannelUrl(env)).toBe("https://example.com/legacy-channel");
    expect(resolvePodcastWorkflowPythonBin(env)).toBe("/opt/legacy/python3");
  });

  it("falls back to the standard python name when no override is configured", () => {
    expect(resolvePodcastWorkflowPythonBin({} as NodeJS.ProcessEnv)).toBe("python3");
  });
});
