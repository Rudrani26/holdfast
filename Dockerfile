# Holdfast — Cloud Run image (TASKS T-070). Next.js standalone output, non-root, port 8080.
# No secrets or env values are baked in: everything (including the public PayPal client id, which the
# booking page reads on the server) comes from Cloud Run env vars and Secret Manager at runtime.
# Pin the base image by digest at deploy time (scripts/deploy.md).

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# PAYPAL_ENV is not a secret; the env check (src/lib/env.ts) requires it wherever the app loads.
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone PAYPAL_ENV=sandbox
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
CMD ["node", "server.js"]
