# OpenShorts · 开片

<p align="center"><b>中文</b> · <a href="README.en.md">English</a> · <a href="https://os.aiolaola.com/">官网</a> · <a href="https://os.aiolaola.com/en/">Website</a></p>

> **同名说明**：本项目是 `jnMetaCode/openshorts`（中文名「开片」，拼音 Kaipian）——**话题进，成片出**。与 [mutonby/openshorts](https://github.com/mutonby/openshorts)（openshorts.app，把长视频切成短片的工具）是两个互不相关的项目，只是恰好重名。

**文案进，成片出。** 一条本地优先的开源短视频生产线：给一个话题，它写脚本、找画面、配音、烧字幕、出成片和发布文案——
**默认零成本跑通第一条**，花多少钱、等多久，运行前就告诉你。

<table align="center">
<tr>
<td width="50%" valign="middle" align="center">
<a href="docs/cases/koubo-onion/"><img src="docs/cases/koubo-onion/onion-12s.gif" width="196" alt="《为什么切洋葱会流眼泪》"></a><br>
<b>《为什么切洋葱会流眼泪》</b><br>
<sub>口播 60s · 0 元 0 key · 6 镜里 2 镜本机现画</sub>
</td>
<td width="50%" valign="middle" align="center">
<a href="docs/cases/koubo-en-cat-box/"><img src="docs/cases/koubo-en-cat-box/en-cat-box-9s.gif" width="196" alt="Why cats squeeze into cardboard boxes"></a><br>
<b>Why cats squeeze into boxes</b><br>
<sub>英文成片线 · 56s · 脚本 / 音色 / 字幕全英文</sub>
</td>
</tr>
<tr>
<td width="50%" valign="middle" align="center">
<a href="docs/cases/koubo-compass/"><img src="docs/cases/koubo-compass/compass-9s.gif" width="196" alt="《指南针指的真不是正北》"></a><br>
<b>《指南针指的真不是正北》</b><br>
<sub>43s · 7 镜里 5 镜的素材被看图把关退回、改本机现画</sub>
</td>
<td width="50%" valign="middle" align="center">
<a href="docs/cases/drama-convenience-store/"><img src="docs/cases/drama-convenience-store/local-draft-q2.gif" width="300" alt="《深夜便利店》AI 短剧"></a><br>
<b>《深夜便利店》</b><br>
<sub>AI 短剧线 · 本机 sd.cpp 草稿档 · 0 元</sub>
</td>
</tr>
</table>

<p align="center"><sub>四条都由 OpenShorts 实际生成，点图进各自案例页（含模型原话、素材署名、质检输出，以及哪一镜不行）。</sub></p>
<p align="center"><b><a href="https://os.aiolaola.com/">🌐 官网 · 看真实成片</a></b> · <a href="https://github.com/jnMetaCode/openshorts/releases">下载发布包</a> · <a href="README.en.md">English</a></p>

![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen) ![Tests](https://img.shields.io/badge/tests-269%20passing-brightgreen) ![CI](https://img.shields.io/badge/CI-ubuntu%20%7C%20macOS%20%7C%20windows-brightgreen) ![Format](https://img.shields.io/badge/format-9%3A16%20%7C%2016%3A9-blue)

```bash
git clone https://github.com/jnMetaCode/openshorts.git
cd openshorts && npm install
npm run openshorts      # 起本地服务并打开浏览器（http://127.0.0.1:4174）
```

需要 Node.js 20+ 和 FFmpeg（npm 包即将发布，届时一行 `npx openshorts` 即可；当前请用源码或 [Release 包](https://github.com/jnMetaCode/openshorts/releases)）。

**不想自己装？把下面这段话发给你的 AI（Claude Code / Codex / Cursor…），它会自己装好、体检、写脚本、出片，最后把文件路径给你：**

```text
使用这个 Skill：https://raw.githubusercontent.com/jnMetaCode/openshorts/main/docs/skill/SKILL.md
帮我做一条关于"为什么天空是蓝色的"的科普短视频。
```**装完先跑一次 `openshorts doctor`**——它会告诉你这台机器现在能不能出片，以及缺什么。

---

## 长什么样

四步走完一条片：**输入 → 来源与花费 → 预览与调整 → 出片与发布**。顶部一行状态回答"我这台机器现在能干什么"，
模型配置收在「⚙ 设置」里（写脚本的模型、看图把关的模型，存之前会拿它真发一次请求验一下）。

<table>
<tr>
<td width="50%" valign="top"><a href="docs/assets/ui/input.png"><img src="docs/assets/ui/input.png" alt="① 输入"></a><br>
<b>① 输入</b><br><sub>给个话题，或直接粘一整段文案，也可以贴一个文章链接让它抓正文。目标时长和语气可选。</sub></td>
<td width="50%" valign="top"><a href="docs/assets/ui/edit.png"><img src="docs/assets/ui/edit.png" alt="③ 预览与调整"></a><br>
<b>③ 预览与调整——每一镜都能改</b><br><sub>每镜左边就是它<b>实际用的那张画面</b>；口播文案、画面意图、英文检索词都能直接改。改完只重出那一镜——配音按"文案 + 音色 + 语速"的指纹复用，没动过的镜头一秒都不重跑。</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/assets/ui/final.png"><img src="docs/assets/ui/final.png" alt="④ 出片与发布"></a><br>
<b>④ 出片与发布</b><br><sub>成片、SRT、封面一次给全；标题点一下就复制；<b>每一条素材的作者与许可证都列出来</b>（CC BY-SA 要求的署名一条不少）。</sub></td>
<td width="50%" valign="top"><br><b>质检逐项报事实</b><br><sub>分辨率 / 时长偏差 / 响度 / 字幕有没有烧进画面 / AI 标识 / 有几镜是本机生成的、有几镜经过看图把关——<b>只报事实，不替你下结论</b>。最后按平台规格打发布包：<b>不自动发布</b>，拖进后台由你决定。</sub></td>
</tr>
</table>

## 为什么选开片（和 MoneyPrinterTurbo 们的区别）

| 你关心的 | 开片 | 素材拼片类工具（如 MoneyPrinterTurbo） | 平台一键 AI 工具 |
|---|---|---|---|
| **第一条片要花多少钱、要配什么** | **0 元、0 个 key**：CC 图片（完整图 + 虚化垫底 + 缓推）与视频 + Edge TTS + 本机 ffmpeg；注册免费 Pexels key 后换成实拍视频，画面更好 | 要先注册素材库 key | 会员 / 积分 |
| **素材库没货怎么办** | **本机现画一张**（FLUX.1-schnell，Apache-2.0 可商用，不花钱不联网）——洋葱、抽象概念这类题材素材库里本来就没有 | 只能凑合用不相干的 | 平台自家模型 |
| **画面从哪来** | 素材库 · 本机出图 · 本地出片（sd.cpp）· 云端 AI（秘塔 / 火山 / Agnes …）· 图层动画，**同一条片可混用** | 只有素材库（近期加了一家云端） | 只有平台自家模型 |
| **谁来把关** | 看图验收员：每条候选素材抽一帧按"画面意图"打 0–10 分，**≥6 才能当主画面，4–5 只能补切段，<4 判退**，不及格就回落到本机出图。没配看图模型时，质检会明说"这些画面没人看过" | 无 | 人工 |
| **画面多久换一次** | 一镜切多段，**平均 4–6 秒一换**（不切时是 10 秒），切到的每一段都过了相关性门槛 | 随机拼接，不做相关性检查 | 黑盒 |
| **花钱之前知道要花多少** | 运行前按所选供应商 / 档位 / 秒数给数量级；口播线钱恒为 0，`estimate` 报的是**要等多久** | 无 | 事后看余额 |
| **改一镜要不要全重来** | 单镜重出：口播改一句话只重出那一镜；短剧按验收意见 / 提意见 / 换来源 | 全部重跑 | 重新生成 |
| **脚本谁写** | 276 位专家角色分工（科普作者写稿、抖音策略师起标题、编剧拆三镜） | 一个通用 prompt | 黑盒 |
| **数据在哪** | 本地优先：key 只存本机，产物在你硬盘，素材署名与 AI 标识写进发布文案 | 本地 | 云端 |
| **怎么装** | 克隆一行跑 / Release 包 / Docker（npm 包即将发布） | Python 环境 / 整合包 | App |

一句话：**别人给你一个出片按钮，开片给你一条能看见成本、能被审、能改单镜的生产线。**

## 成片示例

**v2 · 开片**（由四步界面或 `openshorts` 命令行生成）

| 成片 | 路线 | 时长 | 案例 |
| --- | --- | --- | --- |
| 《为什么切洋葱会流眼泪》 | 口播科普 · CC 素材 + **本机 FLUX 出图** · 看图把关 · 一镜切多段 · **0 元 0 key** | 60s | [docs/cases/koubo-onion](docs/cases/koubo-onion/) |
| 《指南针指的真不是正北》 | 口播科普 · **7 镜里 5 镜的素材被看图把关全判不及格** → 全部本机现画 · **0 元 0 key** | 43s | [docs/cases/koubo-compass](docs/cases/koubo-compass/) |
| *Why cats squeeze into boxes* | 口播科普 · **英文成片线**（脚本 / 音色 / 字幕断行 / 发布包全英文） | 56s | [docs/cases/koubo-en-cat-box](docs/cases/koubo-en-cat-box/) |
| 《猫为什么总爱钻纸箱》 | 口播科普 · 免 key 素材 · Edge TTS（**早期版本**，字幕与画面都不如上面那条，留作对照） | 37s | [docs/cases/koubo-cat-box](docs/cases/koubo-cat-box/) |
| 《深夜便利店》本地草稿档 | AI 短剧 · 本地 sd.cpp · MiniMax-H3 Q2 · **0 元** | 7s | [docs/cases/drama-convenience-store](docs/cases/drama-convenience-store/) |
| 《深夜便利店》云端成片档 | AI 短剧 · Agnes agnes-video-2.5-flash | 13s | 同上（同一故事的草稿 vs 成片对照） |
| 《留下来的那个》奶奶与猫 | AI 短剧 · 故事与画质块取自 [ai-shortfilm-prompts 模板](https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/main/templates/elderly-cat-companion.zh.md) · Agnes · **人+猫三镜一致** | 13s | [docs/cases/drama-grandma-cat](docs/cases/drama-grandma-cat/) |

**v1 · 图层动画**（纸片剪纸风格，`npm run story -- <名字> render` 渲出，见文末）

| 成片 | 路线 | 时长 | 内容源 |
| --- | --- | --- | --- |
| 《后羿射日》 | 故事片 · 纸片动画 | 62s | [content/nine-suns](content/nine-suns) |
| 《三天荔枝道》 | 故事片 · 纸片动画 | 55s | [content/lychee-road](content/lychee-road) |
| 《这条视频是它自己生成的》 | 产品演示 · 自举 | 48s | [content/openshorts-demo](content/openshorts-demo) |

示例均由 OpenShorts 实际生成；案例页里连"哪一镜不够好、为什么"都如实标着。

> v2 方向与设计文档见 [`docs/v2/`](docs/v2/00-README.md)（需求 / 架构 / 开发计划 / 决策记录 / 同类项目拆解）。
> 编排与出片引擎复用 [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)。

## 快速开始（v2 · 开片）

需要 Node.js 20+ 和 FFmpeg。起本地服务并打开浏览器（默认 http://127.0.0.1:4174）：

```bash
git clone https://github.com/jnMetaCode/openshorts.git
cd openshorts && npm install && npm run openshorts
```

（npm 包即将发布，届时一行 `npx openshorts` 即可。）

> **装完先跑一次 `openshorts doctor`。** 短视频的字幕必须**烧进画面**（抖音、视频号一律不认软字幕轨），
> 而烧字幕要 ffmpeg 带 libass。**Homebrew 现在的 `ffmpeg` formula 已经不再依赖 libass**
> （`brew deps ffmpeg` 里没有它），所以 `brew install ffmpeg` 装出来的那份烧不了字——重装也没用。
> doctor 查到就照它说的跑一次 `openshorts install-ffmpeg`：装一份带 libass 的到 `~/.openshorts/bin`
> （约 40 MB，只对开片生效，不动系统 ffmpeg）。界面第 2 步也有同一个按钮。

命令行同一套能力：

```bash
openshorts doctor                                   # 体检：ffmpeg / libass / 中文字体 / ulimit / 各画面来源
openshorts install-ffmpeg                           # doctor 说缺 libass 时跑这个（字幕才能烧进画面）
openshorts new koubo-kepu --topic "猫为什么总爱钻纸箱" --voice zh-CN-YunxiNeural --local-dir ./素材
openshorts new --lang en --topic "why cats squeeze into boxes"   # 出英文片：脚本/音色/字幕断行整条链路按英文来
openshorts run ~/OpenShorts/猫为什么总爱钻纸箱/project.json   # 0 元：Edge TTS + 素材库/本地素材 + 本机 ffmpeg
openshorts run ~/OpenShorts/猫为什么总爱钻纸箱/project.json --only s2   # 只重出第 2 镜（换素材），其余复用
openshorts install-image                             # 本机文生图模型（FLUX.1-schnell，Apache-2.0）：素材库没命中时现画一张
openshorts estimate ~/OpenShorts/<项目>/project.json  # 要花多少钱、大概等多久
openshorts export  ~/OpenShorts/<项目>/project.json --platform douyin   # 发布包（mp4+封面+SRT+文案），不自动发布
openshorts batch   ~/OpenShorts/<项目>/project.json --captions douyin,clean   # 同脚本出多版
openshorts rm      ~/OpenShorts/<项目>/project.json --yes   # 删项目（整个目录，不可恢复；不带 --yes 只预告）
openshorts drama --plan -i story="…" -i video_provider=local-sdcpp -i video_model=minimax-h3-q2   # AI 短剧：先看花费
```

- 写脚本要一个文本模型：用你自己的 key（复用 [AO](https://github.com/jnMetaCode/agency-orchestrator) 的 `~/.ao` 配置或环境变量如 `DEEPSEEK_API_KEY`），**或者本机 [Ollama](https://ollama.com) 模型、一把 key 都不用**（设置 → 写脚本的模型 → `ollama`）。本机模型的档位要说实话：7B 能跑通整条链路，但稿子偏薄、偶尔编事实（真机写出过"地理北极在地球南极附近"）；开片会自动重写和扩写偏短的稿，但要发出去的片子请用 **14B 以上**（`ollama pull qwen2.5:14b`）或云端模型；画面**不配 key 也能出**（Wikimedia Commons 的 CC 图片为主、视频为辅；图片检索比视频准得多，静图会加虚化垫底与缓推），配一把免费的 Pexels / Pixabay key 换成实拍视频会更好（界面一分钟引导）；配音默认 Edge TTS（免费）；怕它哪天被微软改坏，可在 `~/.openshorts/config.json` 配 `tts.fallback = { provider, model, voice }`（AO 里有语音端点的供应商），Edge 挂了自动改走。产品不内置任何共享 key。
- **本机出图**（口播线）：`openshorts install-image` 装 FLUX.1-schnell（6.4 / 10 GB 两档，Apache-2.0 可商用）。装了之后，素材库没命中的镜头会本机现画一张（M2 Max 实测约 57 秒），而不是退纯色底。
- **本地出片**（短剧线）：`openshorts doctor` 会告诉你这台机器能跑哪一档（24 GB 内存起，草稿画质），以及 sd-cli 与模型怎么装。镜头提示词按 [ai-shortfilm-prompts](https://github.com/jnMetaCode/ai-shortfilm-prompts) 的五段式写：氛围锁定块三镜逐字共用，每镜提示词在第 4 屏可看可复制，拿去别的模型抽卡也行。
- 产物落在 `~/OpenShorts/<项目>/`；成片默认带 AI 生成标识；素材署名写进发布文案。

v1 的图层动画编辑器仍在 `/editor`，用法见 [`docs/v1.md`](docs/v1.md)。

### 让 AI agent 直接出片（MCP）

开片自带一个 stdio 的 [MCP](https://modelcontextprotocol.io) server：Claude Code、Claude 桌面版、Cursor 等一句"给我做一条 60 秒的 X 科普"，就能在你这台机器上拿到成片。

```bash
# Claude Code（git 检出方式；npm 包发出后改成 `npx openshorts mcp`）
claude mcp add openshorts -- node ~/openshorts/bin/openshorts.mjs mcp
```

工具：`create_video`（话题 → 脚本 → 画面 → 配音 → mp4；出片要 1–25 分钟，所以立刻回任务号）、`render_project`（改过 `project.json` 后重出）、`job_status`（状态、最近日志，完成后给成片 / 字幕 / 封面 / 发布文案的路径和质检提醒）、`list_projects`、`doctor`。全程本机、用你自己的 key 或本机 Ollama，不上传、不自动发布。脚本用户可以直接用 `openshorts new --json` / `openshorts run --json`（stdout 末行，前缀 `@@json`）拿同一份结构化结果。

### 桌面版（Electron，不需要装 Node）

```bash
cd desktop && npm install && npm run dist:mac   # 或 dist:win；产物在 desktop/release/
```

打出的 app 自带 Node 运行时（Electron 44 / Node 24，**macOS 13+**、Windows / Linux 64 位），双击即用：本地引擎自动启动（端口 4174 起自动顺延），
v1 的工程与产物写在系统的应用数据目录（`OPENSHORTS_V1_DATA`），开片自己的成片仍在 `~/OpenShorts`。

**不想自己打包就直接下**：[desktop-v0.1.0](https://github.com/jnMetaCode/openshorts/releases/tag/desktop-v0.1.0)
提供 mac（arm64 / x64 dmg）、Windows（exe）、Linux（AppImage）四个安装包和 SHA256 校验和，
随 `desktop-v*` 标签自动构建。安装包**未签名**，首次打开需在「系统设置 → 隐私与安全性」放行。
> 老实说一句验证程度：**mac arm64 包我们真下下来装过并跑通**（校验和 OK、codesign 通过、
> 界面与接口正常）；**win / linux 包只经过 CI 构建与"界面已落包"检查，没有人工实测过**。

---

## v1 · 图层动画编辑器

v1 的纸片剪纸 / 信息板路线作为「图层动画」这一种画面来源保留，编辑器仍在 `/editor`，
渲染脚本（`npm run render` / `quality` / `story` …）、项目协议、素材溯源、配乐与旁白验收的完整说明
搬到了 [`docs/v1.md`](docs/v1.md)。

## 姊妹项目

同一套「AI不止语」生态，从写代码到出片，各自独立、组合更强：

| 项目 | 定位 | 一句话 |
|------|------|-------|
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) ![](https://img.shields.io/github/stars/jnMetaCode/agency-agents-zh?style=flat&label=%E2%AD%90) | 🎭 专家角色库 | 277 个**即插即用** AI 专家，含 64 中国原创（小红书 / 抖音 / 飞书 / 钉钉 / Qt 上位机 / 机械设计） |
| [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) ![](https://img.shields.io/github/stars/jnMetaCode/superpowers-zh?style=flat&label=%E2%AD%90) | 🧠 工作方法论 | 20 个 skills 教 AI 怎么干活（TDD / 调试 / 代码审查等） |
| [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) ![](https://img.shields.io/github/stars/jnMetaCode/agency-orchestrator?style=flat&label=%E2%AD%90) | 🚀 编排引擎 | 一句话 → 276 专家协作，**几分钟出方案**（15 种大模型 / 11 种免 key） |
| [ai-coding-guide](https://github.com/jnMetaCode/ai-coding-guide) | 📖 实战教程 | 66 个 Claude Code 技巧 + 10 款工具最佳实践 + 配置模板 |
| [shellward](https://github.com/jnMetaCode/shellward) | 🛡️ 安全中间件 | 8 层防御 + DLP 数据流 + 注入检测，**零依赖**（含 MCP Server） |
| [ai-shortfilm-prompts](https://github.com/jnMetaCode/ai-shortfilm-prompts) | 🎬 视频提示词 | Mx-Shell《丧尸清道夫》5 段式方法论 + Skill，Seedance / 小云雀 / Sora / 可灵 / 即梦通用 |
| [local-agent-toolkit](https://github.com/jnMetaCode/local-agent-toolkit) | 🛠️ Agent 本地三件套 | 给 agent 配上**记忆 / 技能管理 / 运行追踪**，零依赖、数据不出本机（engram · skillet · tracelet） |
| **本项目**（openshorts） | 🎥 短视频生产线 | 开片 —— 文案进，成片出：脚本 / 配音 / 字幕 / 成片 / 发布包一条龙，**0 元 0 key 跑通第一条** |
| [codepet](https://github.com/jnMetaCode/codepet) | 🐾 桌面养成桌宠 | 码宠 CodePet —— 你写代码 / 用 Claude Code，它就涨经验、升级、换状态、跳舞。**全本地、隐私优先** |

## 开源贡献

提交前运行：

```bash
npm test
npm run validate
npm run build
```

欢迎贡献新的风格模板、动画预设、素材供应器和验收规则。不要提交受版权限制的素材、声音克隆样本或密钥。
