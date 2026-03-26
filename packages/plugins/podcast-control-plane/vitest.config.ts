import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: [
      {
        find: "@paperclipai/plugin-sdk/testing",
        replacement: fileURLToPath(new URL("../sdk/src/testing.ts", import.meta.url)),
      },
      {
        find: "@paperclipai/plugin-sdk/ui/hooks",
        replacement: fileURLToPath(new URL("../sdk/src/ui/hooks.ts", import.meta.url)),
      },
      {
        find: "@paperclipai/plugin-sdk/ui",
        replacement: fileURLToPath(new URL("../sdk/src/ui/index.ts", import.meta.url)),
      },
      {
        find: "@paperclipai/plugin-sdk",
        replacement: fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["tests/**/*.{spec,test}.ts"],
    environment: "node",
  },
});
