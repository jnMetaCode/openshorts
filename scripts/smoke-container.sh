#!/usr/bin/env bash
# 镜像建出来了，不等于它能跑。
#
# CI 的 docker 任务一直只 build 不 run——跟桌面包那道闸修之前是同一个盲区：
# #14 证明"取引擎内部模块"这类事只在真跑起来时才暴露，而它恰好是界面一打开就要用的。
# 这里把镜像真起一个容器，打几条页面加载时就会请求的路由（两条必须取到引擎内部模块）。
set -euo pipefail
IMAGE="${1:-openshorts:ci}"
PORT="${SMOKE_PORT:-4475}"
NAME="openshorts-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# 数据目录用容器内的临时卷，不挂宿主机目录：只验"能不能起来、接口对不对"
docker run -d --name "$NAME" -p "$PORT:4174" -e HOST=0.0.0.0 -e PORT=4174 "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
  docker ps -q --filter "name=$NAME" | grep -q . || { echo "::error::容器启动即退出，日志："; docker logs "$NAME" 2>&1 | tail -30; exit 1; }
  sleep 1
done

fail=0
check() {  # 名字 路径 期望片段
  body=$(curl -fsS --max-time 25 "http://127.0.0.1:$PORT$2" 2>/dev/null) || { echo "  ✗ $1 —— 请求失败"; fail=1; return; }
  case "$body" in (*"$3"*) echo "  ✓ $1" ;; (*) echo "  ✗ $1 —— 回的内容里没有 ${3}：$(printf '%s' "$body" | head -c 160)"; fail=1 ;; esac
}
check "健康检查"            "/api/health"                    '"ok":true'
check "首页"                "/"                              "<"
check "供应商表（引擎内部模块）" "/api/kaipian/providers/text" '"providers"'
check "key 状态"            "/api/kaipian/ao-status"         '"hasTextKey"'
check "本机出片档位（引擎内部模块）" "/api/kaipian/local/status" '"catalog"'
check "ffmpeg 能力"         "/api/kaipian/ffmpeg"            '"found"'
check "体检"                "/api/kaipian/doctor"            '"status"'

# 镜像里必须带 libass，否则字幕烧不进画面——成片传到平台上没有字（Dockerfile 装 ffmpeg 就是为这个）
# 注意别写成 `… | grep -q`：grep 命中就关管道，ffmpeg 收到 SIGPIPE，set -o pipefail 会把整条判成失败——
# 滤镜明明在，检查却报没有（第一次本地跑就是这么误报的）。先取回文本再匹配。
filters=$(docker exec "$NAME" ffmpeg -hide_banner -filters 2>/dev/null || true)
case "$filters" in (*" subtitles "*) echo "  ✓ 镜像里的 ffmpeg 带字幕滤镜（libass）" ;; (*) echo "  ✗ 镜像里的 ffmpeg 没有 subtitles 滤镜——字幕烧不进画面"; fail=1 ;; esac
# 容器以非 root 跑，且数据目录可写（挂命名卷时属主弄错会让存 key / 出片全部 EACCES）
docker exec "$NAME" sh -c 'touch /home/node/.openshorts/.smoke && rm /home/node/.openshorts/.smoke' 2>/dev/null && echo "  ✓ 配置目录可写（非 root 用户）" || { echo "  ✗ 配置目录不可写"; fail=1; }

if [ "$fail" != 0 ]; then echo "::error::镜像起来了但接口不对——容器日志："; docker logs "$NAME" 2>&1 | tail -30; exit 1; fi
echo "镜像冒烟通过（${IMAGE}）"
