FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY backend/core-service ./backend/core-service

RUN npm install --workspaces --include-workspace-root
RUN npm --workspace @cinema/shared-types run build && \
    npm --workspace @cinema/shared-utils run build && \
    npm --workspace @cinema/api-contracts run build && \
    npm --workspace @cinema/core-service run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/backend/core-service/package.json ./backend/core-service/package.json
COPY --from=builder /app/backend/core-service/dist ./backend/core-service/dist
COPY --from=builder /app/backend/core-service/db ./backend/core-service/db

WORKDIR /app/backend/core-service
EXPOSE 4001

CMD ["node", "dist/src/server.js"]
