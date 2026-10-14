# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
# Same pinned Playwright package installs its matching Chromium and OS libraries.
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
