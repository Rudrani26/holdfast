import { getEnv } from "@/lib/env";

// Runs once at server start. An invalid environment (e.g. PAYPAL_ENV=production) stops the server.
export function register() {
  getEnv();
}
