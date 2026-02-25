FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# ─── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public/ exists so the runner COPY never fails on an empty/absent dir
RUN mkdir -p /app/public

# Optional: git commit SHA and build date passed by the build script.
# Baked into the JS bundle for client-side version display / update detection.
ARG BUILD_ID
ARG BUILD_DATE
ENV NEXT_PUBLIC_BUILD_ID=${BUILD_ID}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}

RUN pnpm build

# ─── Runner ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Carry build vars into the runtime image so /api/version can return them.
ARG BUILD_ID
ARG BUILD_DATE
ENV NEXT_PUBLIC_BUILD_ID=${BUILD_ID}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
