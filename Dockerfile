FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg imagemagick librsvg2-bin fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/* \
    # Debian 的 ImageMagick 是 6.x，没有 magick 统一命令；代码按 IM7 约定调用，补一个转发垫片。
    # librsvg2-bin 让 SVG 描边正确渲染（内置 MSVG 会丢 stroke）。
    && printf '#!/bin/bash\nif [ "$1" = "identify" ]; then shift; exec identify "$@"; fi\nexec convert "$@"\n' > /usr/local/bin/magick \
    && chmod +x /usr/local/bin/magick && magick -list delegate >/dev/null
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 CHROME_PATH=/usr/bin/chromium
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
RUN mkdir -p out data public/uploads && chown -R node:node /app
USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4174/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
