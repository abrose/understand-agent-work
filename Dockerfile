FROM node:22-slim AS build

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
COPY packages/ui/ packages/ui/

RUN pnpm run build

# Prune dev dependencies after build
RUN CI=true pnpm prune --prod

# ------- runtime -------
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy pruned node_modules with pre-compiled native addons
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/node_modules packages/core/node_modules
COPY --from=build /app/packages/server/node_modules packages/server/node_modules

# Copy package manifests (needed by pnpm workspace resolution at runtime)
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

# Copy built artifacts
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/ui/dist packages/ui/dist

EXPOSE 3000

ENTRYPOINT ["node", "packages/server/dist/index.js"]
