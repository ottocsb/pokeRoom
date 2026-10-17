# ---- build: type-check + bundle client (dist/) and server (dist-server/)
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN npm run build \
  && npx esbuild server/standalone.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/index.mjs \
  && rm -rf node_modules && bun install --frozen-lockfile --production

# ---- runtime: node:sqlite needs Node >= 22.5
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p server-data && chown node:node server-data
USER node
EXPOSE 8787
VOLUME ["/app/server-data"]
CMD ["node", "dist-server/index.mjs"]
