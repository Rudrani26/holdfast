import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Opt-in tests that call the real PayPal Sandbox or Vertex AI. Run only when the owner asks.
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
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    passWithNoTests: true,
    // Real network calls (Firestore transactions under contention, PayPal, Vertex) are slower than unit tests.
    testTimeout: 30_000,
  },
});
