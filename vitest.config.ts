import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only: no network. Sandbox/Vertex tests live in vitest.integration.config.ts.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "spike/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "node_modules/**"],
  },
});
