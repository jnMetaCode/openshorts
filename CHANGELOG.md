# Changelog

## [2.0.0-alpha.1] - 2026-08-30 · M1 口播科普（免费路径跑通）
- `templates/koubo-kepu.yaml`：话题 → 分段口播脚本 JSON（钩子/要点/收尾，每段画面意图 + 英文检索词 + 高亮词，assert 校验 + 验收）→ 标题×3 / 标签×5 / 发布说明 / AI 标识。
- `openshorts new koubo-kepu --topic …`：库调用 AO `run` 跑模板 → 项目 JSON（`~/OpenShorts/<项目>/project.json`）。
- `openshorts run <project.json>`：Edge TTS 配音（msedge-tts，纯 Node，词级时间戳；标点回贴）→ 素材（本地素材夹 → 缓存 → Pexels → Pixabay，去重、候选不够时复用而非纯色）→ 分段渲染（裁 9:16、循环补足）→ 拼接 → 字幕（3 套 ASS 预设，单条 ≤ 4.5 秒；无 libass 时挂软字幕轨）→ BGM ducking → AI 标识（drawtext 或元数据）→ 1080×1920 mp4 + SRT + 封面 + 发布文案（含素材署名）。
- 真机：「猫为什么总爱钻纸箱」6 镜 36.5 秒，脚本 deepseek 约 20 秒，出片 10–13 秒，全程 0 元（本地素材夹）。
- 测试：captions 5 / stock 3 / koubo-project 2（node --test）。

## [2.0.0-alpha.0] - 2026-08-30 · M0 骨架
- v2 方向定案与六份文档（`docs/v2/`）；个人内容拆到私有 papercut-studio，公开仓转 public。
- 依赖 `agency-orchestrator@^0.19.1`；新增 `bin/openshorts.mjs`：`npx openshorts`（open / sources / drama / doctor / version）。
- `openshorts drama`：直接跑 AO 自带的短剧流水线（`templates/ai-drama.template.json` 只记引用，不复制 YAML）；`--validate` / `--plan` 只检查。
- `openshorts sources`：这台机器能用哪些画面来源及原因（素材库 key / AO key / sd-cli 与内存档位 / ffmpeg）。
- `src/config.mjs`：`~/.openshorts/config.json`；API key 沿用 AO 的 `~/.ao`（ADR-008）。
- `src/core/ao-result.mjs`：AO 运行结果 → 项目 JSON 回填（纯函数），用真实短剧运行的 metadata 做快照测试（4 条）。

## 未发布

- 对标 MoneyPrinterTurbo（101k 星）吸收三项：`npm run new` 话题一键起稿（LLM 生成可审阅
  草稿而非黑盒出片，分镜遵循 X 爆款硬规则）；`story.format` 贯通 16:9 横屏（字幕安全区与
  字号自适应，端到端沙箱测试覆盖双画幅）；README 增加徽章、英文简介与成片示例表

- 新增第三条内容路线「产品演示片」及首个样片《这条视频是它自己生成的》（47.7s）：
  自举证明，引用自家渲染产物做画中画；溯源新增 repo-render 类型
- 验收精化：纯文字排版镜头以纯色为底不再误报「缺少 background 图层」

- **项目改名 OpenShorts**（原 OpenShorts Studio 时期名为 PaperCut Studio）：与 Papercut Software™（商标号 79231969，同类计算机软件）冲突，且 open- 前缀更贴开源短视频生产线定位。波及包名、协议名（OpenShorts v1）、Remotion 组合 ID、打包格式 .openshorts.zip、环境变量前缀 OPENSHORTS_*（无兼容层）
- 修 Remotion 入口：inputProps 不会自动过 schema，手写工程缺可选字段时组件崩溃；calculateMetadata 统一 parse 补默认值
- 验收区分「工程无音源的静音」（警告）与「有音源却无声」（错误）

- 字幕改为在标点处断句，不再出现「河干／了」这类词中断行
- 竖屏字幕上移到底部 20% 安全区之上，避开抖音/快手/视频号的账号名与进度条
- 字幕字号改按画面短边计算，横竖屏每行字数一致；单行上限 16 字
- 成片响度对齐短视频平台的 -14 LUFS，真峰值限制在 -1.5 dBFS
- 配乐加入旁白闪避（sidechain ducking），说话时自动压低约 10 dB
- 配乐短于成片时自动循环补齐，片尾不再突然没有音乐
- FFmpeg 渲染器改为自动探测中文字体，Docker/Linux 可用；可用 `OPENSHORTS_SUBTITLE_FONT` 覆盖
- 质检新增字幕阅读速度、单条字数、断句位置和平台响度目标检查
- 音频母带抽成 `scripts/lib/audio-master.mjs`，Remotion 与 FFmpeg 两条渲染路径共用同一套音轨逻辑
- 新增 `npm run master`，可对任意成片单独重建音轨
- `story:render` / `nine-suns:render` 改用 Remotion 出画面，成片恢复入场动画、关键帧与纸片描边
- 修正 FFmpeg 降级渲染的旋转锚点：ImageMagick 绕中心旋转、Remotion 绕底边中点，现已换算一致
- 《三天荔枝道》「倒下的驿卒」坐标按正确的锚点语义重排，不再掉出画面
- 项目协议收敛到 `shared/project-schema.mjs`：浏览器、Remotion、服务端和 CLI 共用同一份 Zod schema
- 服务端写入路径改为完整校验，非法工程返回 400 并指出具体字段，不再存进磁盘等到渲染才崩
- 存盘时自动补齐默认值，磁盘上的工程一定是渲染器能直接读的
- 修正《三天荔枝道》背景关键帧写死第 360 帧的问题，短镜头的背景缓推现在能走完
- 验收新增关键帧超出镜头时长的警告
- 收紧本地服务的跨站访问：只放行本机与 Vite 开发端口，跨站写请求返回 403，可用 `OPENSHORTS_ALLOWED_ORIGINS` 覆盖
- 共享音效移到 `public/audio/common/`，不再按故事复制；仓库音频从 39MB 降到 25MB
- 新增统一入口 `npm run story -- <故事名> [audio|audio:local|build|render|release]`，替代按故事硬编码的 12 条脚本
- 《三天荔枝道》改为数据驱动（`content/lychee-road/storyboard.json`），删除专用构建脚本 `build-lychee-story.mjs`
- 分镜关键帧的 `frame` 支持 `"end"`，随旁白时长自适应到本镜最后一帧
- 编辑器改为响应式，1320 / 1120 / 960px 三档收敛，不再写死 `min-width: 1180px`
- 旁白音色改为可配置（`storyboard.json` 的 `voice` 块），两个故事换用 zh-CN-YunyangNeural
- 新增 `npm run voices` 一次生成多个候选音色的同句对比
- 配乐改为按故事情绪合成（Karplus-Strong 弹拨弦 + Schroeder 混响 + 节奏留白），不再所有故事共用一首
- 新增 `npm run music` 接入自备配乐，导入时归一到 -20 LUFS 并记录署名
- 音频母带加片尾淡出；配乐长度随旁白时长变化自动重算
- 修正 edge-tts 负语速传参（`--rate=-6%`）与 macOS 兜底 TTS 的 `--rate` 参数冲突
- 素材溯源改存 `content/<故事>/assets.json`；原来写在 `projects/*.json` 会被每次构建覆盖，这是两个故事 assetPlan 一直为空的原因
- 新增 `npm run asset` 记录素材来源；验收会报告来源未知的素材，`QUALITY_REQUIRE_PROVENANCE=1` 可升级为错误
- 补齐 `sample.json` 与两个故事的素材溯源；《三天荔枝道》的 5 张 PNG 如实标注为来源未知
- 新增 `npm run comfy`：ComfyUI 生成素材后自动解析 model/seed/提示词并写入溯源，生成与记录合为一步
- 旁白反向验收新增内容覆盖比对：原来只校验「有中文人声」，漏掉一整段照样通过；现在逐段比对文案，阈值按真实转写标定并容忍同音错字
- 图层协议新增 kind:'text' 文字图层：数字、术语、代码可直接上屏并逐行显现，信息板/PPT/终端三种技术讲解风格共用这一个原语；两条渲染路径与编辑器画布均支持
- 《十美元，两小时，五千五百行》改为信息板式：视觉元素 11→40 个，最长静止 14.3s→6s，屏显骨架化避免与字幕逐字重复
- 图层协议新增 kind:'video'：评论/解说时引用真实画面（startFrom 起播、强制静音）；降级路径取海报帧
- 溯源新增 quotation 类型；引用素材本体不进仓库（public/assets/quoted/），来源与再获取方式记录在 assets.json
- Karpathy 片：接入原推真实演示画面、4.5 秒有声封面、作者头衔链（含现职 Anthropic）与利益关系披露
- 配乐新增 pulse 情绪（电子脉冲，科技解说向）
- 新增 content/*/publish.md 发布包（X 引用转发策略、各平台标题话题）

## 1.0.0 - 2026-07-28

- 文案分镜、角色一致性提示词和可编辑草稿工程
- 分层拖拽、关键帧、字幕、音频和 Remotion 渲染
- 绿幕抠图、素材表拆分、ComfyUI 与自动素材匹配
- 提示词历史、生成溯源、素材审核和批量审批
- 旁白波形、本地 ASR、逐字字幕和节奏重排
- 多项目、模板、ZIP 迁移、持久化任务队列和 FFmpeg 验收
- Docker Compose、GitHub Actions、MIT License 和贡献指南
