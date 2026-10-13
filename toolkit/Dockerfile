FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000
WORKDIR /app

# The database lives on a persistent disk mounted at /data, so it survives
# redeploys. Mount a volume there on your host (Fly, Railway, Render…).
ENV DATABASE_URL="file:/data/toolkit.sqlite"

COPY package.json package-lock.json ./
COPY extensions/thank-you-reward/package.json extensions/thank-you-reward/package.json
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
CMD ["npm", "run", "docker-start"]
