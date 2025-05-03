# Use Node.js LTS (hydrogen)
FROM node:lts-alpine AS builder

# Install system dependencies for chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    ca-certificates \
    curl

# Configure environment variables
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium-browser \
    CHROMIUM_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Set up build environment
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY src/ ./src/

# Install and build
RUN npm ci --include=dev && \
    npm run build && \
    rm -rf src/ && \
    npm prune --production

# Production stage
FROM node:lts-alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    ca-certificates \
    curl

# Non-root user for security
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup
USER appuser

# Configure environment
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium-browser

# Copy built assets
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json .

# Health check with curl
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

EXPOSE $PORT
CMD ["npm", "run", "start"]
