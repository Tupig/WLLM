# 多阶段构建：Go 编排服务（含 Web 看板静态资源）
# 构建与运行：
#   docker build -t unity-orchestrator .
#   docker run -d --name unity-orchestrator -p 9111:9111 -v unity-data:/app/data unity-orchestrator
# 或使用 docker-compose up -d
# 构建阶段
FROM golang:1.27-alpine AS build
ARG VERSION=docker
WORKDIR /src
COPY server/go.mod server/go.sum* ./server/
RUN cd server && go mod download 2>/dev/null || true
COPY server/ ./server/
RUN cd server && CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/unity-orchestrator .

# 运行阶段
FROM alpine:3.20
RUN apk add --no-cache ca-certificates && \
    adduser -D -u 10001 platform
COPY --from=build /out/unity-orchestrator /usr/local/bin/unity-orchestrator
COPY static/ /app/static/

ENV PORT=9111 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/static
WORKDIR /app
VOLUME /app/data
EXPOSE 9111

# 非 root 运行（data 卷需可写）
USER 10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --no-check-certificate -O /dev/null https://localhost:9111/api/health || exit 1

ENTRYPOINT ["unity-orchestrator"]
