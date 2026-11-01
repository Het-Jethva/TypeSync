FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN npm ci --workspace @typesync/server --workspace @typesync/shared --include-workspace-root

COPY shared/ ./shared/
COPY server/ ./server/
RUN npm run build -w shared && npm run build -w server

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN npm ci --omit=dev --workspace @typesync/server --workspace @typesync/shared \
    && npx playwright install --with-deps --only-shell chromium \
    && apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY server/drizzle ./server/drizzle

# Expose server port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

USER node

CMD ["sh", "-c", "node server/dist/migrate.js && unset MIGRATION_DATABASE_URL && exec node server/dist/index.js"]
