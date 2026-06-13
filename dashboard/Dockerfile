# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Build-arg: bake auth mode into the bundle at compile time (Vite reads VITE_* vars)
ARG VITE_AUTH_ENABLED=false
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Stage 2: nginx static server ────────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3099
CMD ["nginx", "-g", "daemon off;"]
