#!/usr/bin/env bash
# 打出来的桌面包真的能起来吗？——CI 绿 ≠ 产物对。
#
# 以前这个工作流只检查 dist/index.html 在不在包里（白屏闸），从没启动过包里的后端。
# 而 #14 证明了 Windows 上有八处取引擎模块的调用一直静默失败：设置面板列不出供应商、
# 界面存的 key 重启也不生效——三平台 CI 全绿，因为没有一条测试打过那几个路由。
#
# 这里用包自带的 Electron 当 Node（ELECTRON_RUN_AS_NODE=1）起包内 server，
# 再打那几条页面一打开就会请求的路由。数据目录指到临时目录，不碰真实配置。
set -euo pipefail
REL="${1:-desktop/release}"
PORT="${SMOKE_PORT:-4477}"

# 按**产物布局**找，不按 uname 猜：先找包内的 server 入口，再取它旁边的可执行文件。
# 首次在 CI 上真跑时，按 uname 猜的写法在 Windows 上挑中了 resources/elevate.exe（electron-builder 的辅助程序），
# 后端当然起不来——这道闸因此拦下了那次发版，但拦的是脚本自己的毛病。
BIN=""; SERVER=""
# mac 上优先本机架构：x64 包在 arm64 上走 Rosetta 能跑，但启动要 30 秒
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then ORDER="$REL/mac-arm64 $REL"; else ORDER="$REL"; fi
for base in $ORDER; do
  [ -d "$base" ] || continue
  while IFS= read -r srv; do
    [ -n "$srv" ] || continue
    approot=$(cd "$(dirname "$srv")/../../.." && pwd)      # …/resources/app/server/index.mjs → 含 resources 的那层
    # 取**最大**的那个可执行文件：Electron 主程序有一两百 MB，而同目录的 elevate.exe /
    # chrome_crashpad_handler 只有几百 KB。靠 find 的返回顺序取第一个是碰运气——
    # CI 首跑时正是挑中了 resources/elevate.exe。
    cand=$(find "$approot" -maxdepth 1 -type f -perm -u+x ! -name "*.dll" ! -name "*.so*" ! -name "*.pak" ! -name "*.dat" ! -name "*.bin" ! -name "*.json" -exec ls -S {} + 2>/dev/null | head -1)
    [ -n "$cand" ] || cand=$(find "$approot/MacOS" -maxdepth 1 -type f -perm -u+x -exec ls -S {} + 2>/dev/null | head -1)
    if [ -n "$cand" ]; then BIN="$cand"; SERVER="$srv"; break; fi
  done <<EOF
$(find "$base" -ipath "*resources/app/server/index.mjs" 2>/dev/null)
EOF
  [ -n "$BIN" ] && break
done
[ -n "$BIN" ] && [ -n "$SERVER" ] || { echo "::error::找不到「可执行文件 + 包内 server」这一对（${REL}）"; find "$REL" -maxdepth 4 -type d | head -20; exit 1; }
echo "bin:    $BIN"
echo "server: $SERVER"

TMP=$(mktemp -d)
trap 'kill "${PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT
ELECTRON_RUN_AS_NODE=1 OPENSHORTS_HOME="$TMP/os" AO_DATA_DIR="$TMP/ao" OPENSHORTS_V1_DATA="$TMP/v1" \
  PORT="$PORT" HOST=127.0.0.1 "$BIN" "$SERVER" > "$TMP/log" 2>&1 &
PID=$!

for _ in $(seq 1 90); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/kaipian/config" && break
  kill -0 "$PID" 2>/dev/null || { echo "::error::包内后端启动即退出，日志："; cat "$TMP/log"; exit 1; }
  sleep 1
done

fail=0
check() {  # 名字 路径 期望片段
  body=$(curl -fsS --max-time 20 "http://127.0.0.1:$PORT$2" 2>/dev/null) || { echo "  ✗ $1 —— 请求失败"; fail=1; return; }
  case "$body" in (*"$3"*) echo "  ✓ $1" ;; (*) echo "  ✗ $1 —— 回的内容里没有 ${3}：$(printf '%s' "$body" | head -c 160)"; fail=1 ;; esac
}
# 这四条是页面一打开就会请求的；Windows 上曾经三条 500 而 CI 全绿
check "首页"            "/"                              "<"
check "供应商表（引擎内部模块）" "/api/kaipian/providers/text" '"providers"'
check "key 状态"        "/api/kaipian/ao-status"         '"hasTextKey"'
check "本机出片档位（引擎内部模块）" "/api/kaipian/local/status"  '"catalog"'
check "ffmpeg 能力"     "/api/kaipian/ffmpeg"            '"found"'

if [ "$fail" != 0 ]; then echo "::error::打出来的包起来了但接口不对——后端日志："; cat "$TMP/log"; exit 1; fi
echo "打包产物冒烟通过（$(uname -s)）"
