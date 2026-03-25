import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/openclaw-gateway",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "packages/db",
      "server",
      "ui",
      "cli",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "cli/src/**/*.{ts,tsx}",
        "server/src/**/*.{ts,tsx}",
        "ui/src/**/*.{ts,tsx}",
        "packages/**/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/fixtures/**",
        "**/testing.{ts,tsx}",
      ],
    },
  },
});
