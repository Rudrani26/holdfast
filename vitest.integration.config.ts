import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Opt-in tests that call the real PayPal Sandbox or Vertex AI. Run only when the owner asks.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    passWithNoTests: true,
  },
});
