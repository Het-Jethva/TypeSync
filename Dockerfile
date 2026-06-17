FROM node:20-alpine

WORKDIR /app

# Copy root workspace and package manifests
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Install dependencies (including devDependencies so tsx and typescript are available)
RUN npm ci

# Copy source code (client is ignored by .dockerignore)
COPY shared/ ./shared/
COPY server/ ./server/

# Expose server port
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Run database migrations and start the server using tsx
CMD ["sh", "-c", "npm run db:migrate && npx tsx server/src/index.ts"]
