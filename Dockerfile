FROM node:24-alpine3.24

WORKDIR /app

# Install the musl compatibility layer and Chromium used for document rendering.
RUN apk add --no-cache \
    gcompat \
    chromium \
    && CHROME_BIN="$(command -v chromium-browser || command -v chromium)" \
    && test -n "$CHROME_BIN" \
    && test -x "$CHROME_BIN" \
    && ln -sf "$CHROME_BIN" /usr/local/bin/oakcloud-chromium \
    && /usr/local/bin/oakcloud-chromium --version
ENV CHROME_PATH=/usr/local/bin/oakcloud-chromium

# Copy package files.
COPY package.json package-lock.json* ./

# Install the exact locked dependency graph.
RUN npm ci

# Copy Prisma schema for generation.
COPY prisma ./prisma/

# Copy the rest of the app.
COPY . .

# Verify the installed Chromium can launch, generate a PDF, and render it.
RUN npm run test:chromium

# Build Next.js for production.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run check:assistant-capabilities
RUN DATABASE_URL=postgresql://oakcloud:oakcloud_password@127.0.0.1:5432/oakcloud npm run db:generate
RUN test -f src/generated/prisma/client.ts
RUN NODE_OPTIONS=--max-old-space-size=8192 \
    DATABASE_URL=postgresql://oakcloud:oakcloud_password@127.0.0.1:5432/oakcloud \
    JWT_SECRET=ci-only-build-secret-that-is-not-used-at-runtime-and-is-long-enough \
    ENCRYPTION_KEY=ci-only-build-encryption-key \
    npx next build

# Expose port
EXPOSE 3000

# Start production server
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
