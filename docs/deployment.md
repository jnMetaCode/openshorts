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
