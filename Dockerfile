FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S bot && adduser -S bot -G bot

COPY --from=builder --chown=bot:bot /app/package.json ./package.json
COPY --from=builder --chown=bot:bot /app/node_modules ./node_modules
COPY --from=builder --chown=bot:bot /app/dist ./dist

USER bot
EXPOSE 3030
CMD ["node", "dist/index.js"]
