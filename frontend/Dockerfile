FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY frontend ./frontend

RUN npm install --workspaces --include-workspace-root
RUN npm --workspace @cinema/shared-types run build && \
    npm --workspace @cinema/shared-utils run build && \
    npm --workspace @cinema/api-contracts run build && \
    npm --workspace @cinema/frontend run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

