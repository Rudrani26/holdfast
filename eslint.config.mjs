import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `cn` is only a transitive dep of the shadcn CLI; components must use our clsx + tailwind-merge helper.
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "cn", message: 'Import { cn } from "@/lib/utils" instead.' }] },
      ],
    },
  },
  {
    // AI_PIPELINE.md §8: no AI component may reach PayPal code. Restates the "cn" rule because a
    // files-scoped config replaces the rule options rather than merging them.
    files: ["src/server/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "cn", message: 'Import { cn } from "@/lib/utils" instead.' }],
          patterns: [
            {
              group: ["@/server/paypal", "@/server/paypal/*", "**/server/paypal", "**/server/paypal/*", "**/settlement", "@/server/settlement"],
              message: "AI code must not import PayPal or settlement code (AI_PIPELINE.md §8).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
