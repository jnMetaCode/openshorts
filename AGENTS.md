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

## v2 工程要点（每条都是真机踩出来的）
- **改了出片链路就真出一条片、逐帧看**（`openshorts run` 后 `ffmpeg -ss <秒> -i 片子 -frames:v 1` 抽帧）。这个仓库里值钱的 bug 没有一个是读代码或单测发现的：ffmpeg 6.x 静默丢音轨、Homebrew ffmpeg 无 libass、concat 的 SAR 不一致、假配音固定时长让"一镜切几段"永远触发不了。
- **失败原因必须穿透到用户眼前**：任何 catch / 过滤器吞掉下游报错的地方都按 bug 对待。SSE 失败时带出引擎输出尾巴，不能只给"退出码 1"。
- **跨轮次不要 `{ ...旧对象, 新字段 }` 展开**：退纯色底、重出一镜、resume 运行目录都在这上面出过事——状态换语义时整个换掉。
- **语言只有一个出处**：`src/project/lang.mjs` 的 `tt(lang)`，来源固定为 项目 lang → 请求参数 → 中文。用户可见文案不要写死中文（`tests/helpers-cjk-scan.mjs` 会逐字符扫）。CLI 语言看 `OPENSHORTS_LANG` / locale，故意不认 `--lang`（那是片子的语言）。
- **测试要做变异检查**：写完把被测逻辑故意打断，确认它会红。用不整齐的输入（不同尺寸 / 比例的素材、按字数变化的时长），别用整齐划一的假数据；检测类测试要拿"真机漏掉的那个样本"去验。
- **判断文件用 shell 内建 `[ ]`，不要 `find -exec test`**：PATH 里撞名的 test 程序会把判断整个带偏。
- **CI 绿 ≠ 产物对**：发出去的安装包 / npm 包要真下下来装一遍（`npm pack` → 空目录安装 → 从装出来的那份跑）。
- **对外动作（推送 / 发版 / 打 tag / publish）要用户明确点头**，"继续"不算。

## 提交约定
- 能进 agency-orchestrator 的通用能力（素材库源、本地生成供应商、TTS）先在这里验证，再上提到 AO，本仓库只留产品层。
- 每条示例成片都要标"由 OpenShorts 实际生成 · 来源/模型"，并附项目 JSON。
- 测试：`npm test`（node --test）。改协议必须同步 `shared/project-schema.mjs` 与对应测试。
