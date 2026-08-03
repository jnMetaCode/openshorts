# papercut-studio 开发协作说明

## 做 X 平台视频（最常见任务）

**动手前必读 `docs/x-viral-video-playbook.md`**——基于 84 条 X 高浏览视频帖蒸馏 + 8 支头部片逐帧拆解的制作规范。核心三条：

1. 第一镜即主体，禁止 logo/封面卡开场（品牌卡放片尾）
2. 每 2-3 秒一次视觉推进；真实素材（quoted/录屏）优先于生成 SVG
3. 结尾画面定格收，不加总结口播；提交渲染前过文档第三节的检查清单

## 工程要点

- 每个 layer 必须显式带 `rotation: 0, opacity: 1`（schema 无默认值，缺了渲染崩）
- `content/<id>/storyboard.json` 与 `projects/<id>.json` 两份 scenes 要同步；渲染只认 `projects/`
- 渲染：`node scripts/render.mjs projects/<id>.json` → `out/<id>.mp4`；验收看文件 mtime + 抽帧，别信管道退出码
- 引用素材（他人视频片段）：放 `assets/quoted/`（gitignored）、屏显署名、`assets.json` 记 license 与时间点、评论/解说用途短引用
