import path from "node:path";

// Shared settings for the scripted demo capture (docs/DEMO_VIDEO_PRODUCTION.md §5).

/** The hosted app the video is recorded from (real PayPal Sandbox, live Gemini). */
export const BASE_URL = process.env.DEMO_BASE_URL ?? "https://holdfast-806240887939.us-central1.run.app";

/** Persistent browser profile in which the owner signed in once as the sandbox buyer (gitignored). */
export const PROFILE_DIR = path.resolve("video/capture/.profile");

export const DESKTOP = { width: 1920, height: 1080 } as const;
export const PHONE = { width: 390, height: 844 } as const;

/** Real photos for each journey (gitignored; see demo-assets/README.md). */
export const ASSETS_DIR = path.resolve("demo-assets");
export const ANGLES = ["front", "back", "left", "right", "top", "bottom"] as const;
