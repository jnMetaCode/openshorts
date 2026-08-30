# OpenShorts 开发协作说明（给贡献者与 AI 助手）

## 方向
- v2 定案见 `docs/v2/`（先读 `00-README.md` → `01 PRD` → `03 开发计划`）。两条内容线（口播短视频 / AI 短剧）× 三种画面来源（素材库 / 本地生成 / 云端 API），引擎复用 agency-orchestrator。
- v1 的剪纸动画 / 信息板路线作为 `layered` 画面来源保留；不要再往 v1 路线加内容特化逻辑。

## 工程要点（v1 协议，仍然有效）
- 项目 JSON 是内核：界面、CLI、渲染器只读 `projects/<id>.json`；每个 layer 必须显式带 `rotation: 0, opacity: 1`（schema 无默认值，缺了渲染崩）。
- `content/<id>/storyboard.json` 与 `projects/<id>.json` 两份 scenes 要同步；渲染只认 `projects/`。
- 渲染：`node scripts/render.mjs projects/<id>.json` → `out/<id>.mp4`；验收看文件 mtime + 抽帧，别信管道退出码。
- 引用素材（他人视频片段）放 `assets/quoted/`（gitignored），屏显署名，`assets.json` 记 license 与时间点。
- 素材来源、模型、种子、成本必须进 provenance；切换画面来源不得改脚本/配音/字幕。

## 提交约定
- 能进 agency-orchestrator 的通用能力（素材库源、本地生成供应商、TTS）先在这里验证，再上提到 AO，本仓库只留产品层。
- 每条示例成片都要标"由 OpenShorts 实际生成 · 来源/模型"，并附项目 JSON。
- 测试：`npm test`（node --test）。改协议必须同步 `shared/project-schema.mjs` 与对应测试。
