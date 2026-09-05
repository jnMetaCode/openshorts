FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# zip/unzip：发布包的 zip（publish/pack）和 sd-cli 解压都要——缺了不报错，zip 会静默变 null
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg imagemagick librsvg2-bin fonts-noto-cjk ca-certificates zip unzip && rm -rf /var/lib/apt/lists/* \
    # Debian 的 ImageMagick 是 6.x，没有 magick 统一命令；代码按 IM7 约定调用，补一个转发垫片。
    # librsvg2-bin 让 SVG 描边正确渲染（内置 MSVG 会丢 stroke）。
    && printf '#!/bin/bash\nif [ "$1" = "identify" ]; then shift; exec identify "$@"; fi\nexec convert "$@"\n' > /usr/local/bin/magick \
    && chmod +x /usr/local/bin/magick && magick -list delegate >/dev/null
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 CHROME_PATH=/usr/bin/chromium
# 从容器外（非 127.0.0.1）访问时，写操作按 Origin 拦截。默认白名单只有本机——
# 用别的地址打开界面要设 OPENSHORTS_ALLOWED_ORIGINS（如 http://nas.local:4174），见 .env.example
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY projects ./projects
COPY templates ./templates
COPY adapters ./adapters
# v2 的三个数据目录要在切到 node 用户前建好并交出属主：compose 的命名卷首次挂载时
# Docker 按镜像里的目录属主初始化，不建的话挂载点是 root:root——USER node 下
# 存 key、写配置、出片全部 EACCES，等于"数据持久化"把功能本身弄坏了
RUN mkdir -p out data public/uploads /home/node/OpenShorts /home/node/.openshorts /home/node/.ao \
    && chown -R node:node /app /home/node
USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4174/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
