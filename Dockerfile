# 多阶段构建：gameqa 编排服务（TS 版，含 Web 看板静态资源）
# 构建与运行：
#   docker build -t gameqa-orchestrator .
#   docker run -d --name gameqa-orchestrator -p 9111:9111 -v gameqa-data:/app/data gameqa-orchestrator
# 或使用 docker compose up -d
# 构建阶段
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

# 运行阶段
FROM node:22-alpine
RUN apk add --no-cache ca-certificates openssl && \
    adduser -D -u 10001 platform
COPY --from=build /src/dist /app/dist
COPY --from=build /src/node_modules /app/node_modules
COPY package.json /app/package.json

ENV PORT=9111 \
    DATA_DIR=/app/data
WORKDIR /app
VOLUME /app/data
EXPOSE 9111

# 非 root 运行（data 卷需可写；TLS 自签证书生成需要 openssl）
USER 10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --no-check-certificate -O /dev/null https://localhost:9111/api/health || exit 1

ENTRYPOINT ["node", "dist/cli/gameqa.js", "serve"]
