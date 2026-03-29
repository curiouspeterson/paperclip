import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      resolve(ROOT_DIR, "packages/shared"),
      resolve(ROOT_DIR, "packages/db"),
      resolve(ROOT_DIR, "packages/adapters/opencode-local"),
      resolve(ROOT_DIR, "server"),
      resolve(ROOT_DIR, "ui"),
      resolve(ROOT_DIR, "cli"),
    ],
  },
});
