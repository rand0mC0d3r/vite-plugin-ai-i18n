import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The generated runtime module imports the package's own `./runtime` subpath. Point it at the source so tests that
    // load generated modules from temporary directories can resolve it.
    alias: [
      {
        find: /^vite-plugin-ai-auto-i18n\/runtime$/,
        replacement: fileURLToPath(new URL("./src/runtime/index.ts", import.meta.url)),
      },
    ],
  },
});
