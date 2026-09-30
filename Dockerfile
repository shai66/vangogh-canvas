FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=1854 \
    CACHE_DIR=/cache
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
RUN mkdir /cache && chown node:node /cache
USER node
VOLUME /cache
EXPOSE 1854
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-1854}/healthz" || exit 1
CMD ["node", "build"]
