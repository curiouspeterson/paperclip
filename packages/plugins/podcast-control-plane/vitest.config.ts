import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@paperclipai/plugin-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
      "@paperclipai/plugin-sdk/ui": fileURLToPath(new URL("../sdk/src/ui/index.ts", import.meta.url)),
      "@paperclipai/plugin-sdk/ui/hooks": fileURLToPath(new URL("../sdk/src/ui/hooks.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
