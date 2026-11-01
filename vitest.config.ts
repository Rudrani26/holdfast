import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only: no network. Sandbox/Vertex tests live in vitest.integration.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "spike/**/*.test.ts", "scripts/**/*.test.ts", "eval/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "node_modules/**"],
  },
});
