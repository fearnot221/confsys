FROM node:24.21.0-bookworm-slim AS build
RUN npm install --global pnpm@10.34.7
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/main.js"]
