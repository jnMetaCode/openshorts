# 部署指南

## 本地创作工作站

```bash
npm ci
npm run build
npm start
```

服务默认仅监听 `127.0.0.1:4174`。FFmpeg、ImageMagick 和 Chrome/Chromium 必须在 PATH 中，或者通过 `CHROME_PATH` 指定浏览器。

## Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
docker compose logs -f papercut-studio
```

项目、输出、任务数据和上传素材分别挂载到 `projects`、`out`、`data` 和 `public/uploads`。升级容器前应备份这些目录。

## ASR 与生成服务

容器内的 `PAPERCUT_ASR_COMMAND` 必须指向容器能够执行的程序。如需调用宿主机 ASR，建议单独封装 HTTP/命令适配器并挂载只读模型目录。ComfyUI 使用 `COMFYUI_URL`，不要将未认证的 ComfyUI 端口暴露到公网。

## 网络安全

内置服务没有账号系统。对外部署时应使用 Caddy、Nginx 或其他反向代理提供 TLS、身份验证、请求大小限制和访问日志。不要把 `.env`、参考声音或未授权素材提交到仓库。

### 跨站写请求防护

即使只监听 `127.0.0.1`，Studio 开着的时候你浏览的任何网页都能向它发请求——覆盖工程、触发渲染、读取工程内容。只配 CORS 挡不住：CORS 只让浏览器读不到响应，请求本身仍会在服务端执行。

因此所有会改状态的方法（POST / PUT / PATCH / DELETE）都会在服务端按 `Origin` 校验：

- 默认放行 `http://127.0.0.1:{PORT}`、`http://localhost:{PORT}` 及 Vite 开发端口 `4173`（含 IPv6 形式）。
- 不带 `Origin` 的请求放行——curl、CI 脚本和 CLI 不是浏览器攻击面。
- 其余来源返回 403，响应里会列出当前允许列表。

从局域网地址或反向代理域名访问时需要显式放行：

```bash
PAPERCUT_ALLOWED_ORIGINS="http://192.168.1.5:4174,https://studio.example.com" npm start
```

设为 `*` 可退回旧的全开行为，但只应在完全可信的网络里使用。
