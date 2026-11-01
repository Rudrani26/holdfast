import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container build (Dockerfile) sets NEXT_OUTPUT=standalone for a small self-contained server;
  // local `npm run build && npm start` keeps the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
