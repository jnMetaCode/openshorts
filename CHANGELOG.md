# Changelog

## [2.0.0-alpha.6] - 2026-08-31 · 本地文生图（免 key 画面兜底）+ 修 Node 不认代理

- **Node 的 fetch 不认 `HTTPS_PROXY`**（`NODE_USE_ENV_PROXY` 要 Node 24+，22 上无效），
  而 curl / git / pip 都认。所以在设了代理的机器上，命令行里 curl 得通的地址，OpenShorts 里
  一律 ECONNRESET——报错还长得像对面把你墙了，完全看不出是自己没走代理。
  影响面是**全部联网功能**：素材检索、ffmpeg 安装、本地模型下载、抓正文。
  对需要代理才能连 HuggingFace / GitHub 的用户，等于整个免费路径都用不了。
  修法：`undici` 的 `EnvHttpProxyAgent`（语义与 curl 一致，认 `HTTP(S)_PROXY` / `NO_PROXY`），
  在 CLI 与服务端启动时装一次；没配代理时什么都不做。doctor 里能看到走没走代理。
  - **顺带纠正上一版的一条错误结论**：当时说 Openverse "在 TLS 握手层被 WAF 按指纹拦了"——
    不是。加上代理之后一次就通。裸 TLS 也失败让我确信是对面的问题，其实只是本机根本没走代理。
    教训记在这里：ECONNRESET 先查自己的代理，再怀疑对面。
- **本地文生图**：素材库都没命中时，与其退纯色底，不如本机现画一张。
  用已经装好的 sd-cli（`-M img_gen`），模型 **FLUX.1-schnell**——选它是因为 **Apache-2.0 可商用**，
  而 SDXL-Turbo 和 FLUX.1-dev 都是非商用许可，不能给要发平台的用户埋雷；
  T5-XXL 编码器同样 Apache-2.0，clip_l 是 MIT。两档：Q2 轻档 6.4 GB / Q4 标准档 10 GB。
  出来的是一张图，生成尺寸就按 9:16，直接走上一版做好的图片渲染路径，没新开链路。
  `openshorts install-image [--list] [--model …]`、`run --no-local-image`、界面第 2 步一键装。
  - **真机实测**（M2 Max，Q2 档，Metal）：768×1344 要 113 秒、576×1024 要 68 秒、512×896 要 56 秒。
    默认取 576×1024——这张图是给字幕当背景的，放进 1080×1920 里差别看不出来，省下的是分钟级的等待。
    （之前说"几秒到几十秒"是估的，实测偏慢，以这里为准。）
  - 为什么口播线不用本地**出视频**：H3 每镜 3–4 分钟、模型 27 GB，一条 6 镜口播要 20 分钟以上；
    而口播缺画面的是"狭小空间让它感到安全"这类抽象句（案例里 6 镜退了 2 镜）。
    出图 68 秒一张、只对退化的那一两镜付出，仍然差着一个数量级。本地出视频继续只在短剧线用。
  - 模板加了 `imagePrompt` 字段：`query` 是给素材库按关键词检索用的（越短越好），
    而落到本机出图的恰恰是那些 query 太弱、检索不到的镜头——拿检索词去画画，画出来的就是关键词堆。
    所以让脚本步顺便写一条完整可画的场景描述（主体 + 环境 + 光线），没有时才退回 query。
  - VAE 不从 `black-forest-labs/FLUX.1-schnell` 取：那个仓库在 HF 上是 gated 的，未登录下载直接 401
    （许可证明明是 Apache-2.0，但仍要求先登录接受条款）——对"免 key 免登录"是硬伤。
    改用 `second-state/FLUX.1-schnell-GGUF` 的同名文件。下载器现在会把 401/403 翻译成
    "这个仓库需要登录并接受条款"，而不是甩一个裸状态码。
  - 出图子进程用 `spawn` 不用 `execFile`：sd-cli 跑一分多钟、进度一行行往 stderr 打，
    `execFile` 会全缓存下来，超过 `maxBuffer` 直接把子进程杀掉——一个只在"图出得慢"时发作的坑。
- 素材缓存的键加了版本号：缓存里存的是整个候选对象（含格式化好的许可证文案），
  候选结构或格式一变，旧缓存会把老样子带回来（真机上"CC CC0"修完又从缓存冒出来一次）。
- **安全：会花钱、会下 27 GB 的接口全是 GET，而跨站防护只拦非安全方法。**
  `origin-guard.mjs` 开头写的威胁模型是"开着 Studio 时访问的任何网页都能向 127.0.0.1 发请求，
  覆盖工程、触发渲染"，但它只管 POST/PUT/DELETE——而 v2 的出片、批量、单镜重出、下模型、
  跑短剧全是 GET（EventSource 只支持 GET）。也就是说一个恶意网页里的
  `<img src="http://127.0.0.1:4174/api/kaipian/local/install?what=all&agree=1">`
  就能让你的机器开始下 27 GB，或者用你配好的 key 去调云端视频供应商——那是真花钱的。
  CORS 拦不住（只让浏览器读不到响应，请求照样在服务端执行），`<img>` / `<iframe>` 连 Origin 都不带。
  新增 `createActionGuard`：对这些路径按 `Sec-Fetch-Site` 拦跨站（浏览器一定带这个头，
  curl 和脚本不带，所以 CLI 与自动化不受影响）。真机验过：跨站 403、界面自己的 SSE 200、curl 200、只读接口不受影响。
- **安全：镜头 id 来自模型输出、批量的 variant id 来自命令行参数，都直接拼成了路径。**
  模型返回 `{"id": "../../../tmp/evil"}` 就会把音频写到项目目录外；`--voices ../../x` 同理。
  两处都做了字符白名单（variant id 连点号也不留——留着就还能拼出 `..`）。
- **Windows：路径进 ffmpeg 滤镜图和 concat 清单会被反斜杠转义吃掉**，字幕根本找不到、合成直接失败。
  mac 上反而碰不到（Homebrew 的 ffmpeg 没 libass，走不到烧字幕那条分支），而 Windows 上
  winget / gyan 装的都带 libass，一定会走到。抽出 `escapeFilterPath` / `concatListLine`。

- 模型"已装"的判断从 `existsSync` 改成看文件大小：下载中断会留下 0 字节的壳，
  只查存在会把它当已装（本机的 H3 模型目录就是 4 个 0 字节文件，AO 的状态里报 `present:true`）。
- 界面第 2 步那两张挂着「（M2）」的死卡片处理掉了：「本地生成」现在真能点（装模型），
  「AI 配图」说清是短剧线在用、口播线走本机出图。

## [2.0.0-alpha.5] - 2026-08-31 · 单镜重出 / 配音并发 / 免 key 画面换成 Commons 图片 / 排序不再下整片

- **免 key 路径的画面主力从 Commons 视频换成 Commons 图片**。上一条改动如实报出"画面没经过看图把关"
  之后，问题依然在：Commons 的**视频**库偏科教/历史，字面匹配常配错。同一个 API 换成 `filetype:bitmap`
  就好得多——真机同一批词：`cat cardboard box` → "Cats in cardboard boxes"、`cat sleeping` →
  "Sleeping cat on her back"、`city night traffic` → "City Traffic Illuminated Night"（视频源给的是
  "Wasp eating cat food"）。图片只取 2 条，留一个位给视频，让看图排序在"图 vs 视频"之间挑。
  下的是 2400px 派生图（几百 KB）而不是 6000×4000 原图，排序用 640px 那份。
- **图片走"完整图居中 + 自身放大虚化垫底"，不裁满屏。** 中间试过裁 9:16 + 缓推：一张横构图的猫在纸箱里，
  正好把猫脸切在框外，只剩半只身子——素材库里照片的主体在哪儿是没法预知的。虚化垫底是短视频里的常见做法，
  主体一定不丢，留白也不显廉价。动效放在背景上（完整的前景一动就露边），绕中心各走 6%，方向按镜次交替。
  用 crop 的时间表达式而不是 zoompan（后者缩放按帧量化会抖），crop/scale/gblur/overlay 都是核心滤镜。
- ~~试过、否掉的：Openverse 在 TLS 握手层就把 Node 挡了，是 WAF 的指纹规则。~~
  **这个判断是错的，见下一条。** 真实原因是本机设了 `HTTPS_PROXY` 而 Node 的 fetch 不认代理环境变量。

- **口播线单镜重出**（短剧线早就有，口播线以前每次都全量重跑）。每镜两级缓存，粒度分开是真机测出来的：
  配音只跟「文案 / 音色 / 语速」有关，分段只跟「这段配音 + 这个画面 + 画幅」有关。于是——
  改一句话只重出那一镜；点「只重出这一镜」是丢掉已选素材重新找，文案没动就不重配音；
  换语速则全部重配但画面沿用；重找素材又没找到、仍退回纯色底时，连分段都能复用。
  CLI `openshorts run <project.json> --only s2,s3`、API `?only=`、界面第 3 步每镜一个按钮。
  真机（6 镜）：原样重跑 3.3s → **0.7s**，改一句话只动那一镜。
- **配音并发预取**：各镜配音互不相干，先并发 3 条把配音缓存填满，主循环再照常按指纹命中复用
  （主循环逻辑一行没动）。真机 6 条配音 4.8s → **2.0s**；并发压到 3 是因为 Edge TTS 是非官方端点，
  开太多会被掐，收益也早就平掉了。
- 出片可从界面取消（关 SSE → 服务端中止 ffmpeg），进度已存盘，再点出片接着来。
- `runKoubo` 加 `synthesizeImpl` 注入口（`fetchImpl` 早就有），整条流水线现在能离线跑集成测试：
  新增一条覆盖"首次全配 / 原样零配 / 改一镜只配一条 / 重出画面不重配音 / 换语速全重配"的测试。
- **看图排序改成"先看缩略图，只下中选那条"**。以前每镜把 3 条候选整片下下来、抽帧、扔掉 2 条；
  Commons 上一段 75 秒的猫视频原文件就有 50 MB，6 镜起步 1 GB，而我们只是要看清画面里是什么。
  现在用各来源自带的缩略图打分（Wikimedia 的 `seek=10` 缩略图、Pexels 的 `image`、Pixabay 的 `thumbnail`），
  真机实测：排序阶段的流量 **56.5 MB → 0.09 MB，一条视频都不下**，选定后才下那一条。
  缩略图取不到的候选会按需把片子下下来抽帧再打分——"没证据"和"判过了"是两回事，不能让没打过分的候选混进成片。
  Wikimedia 的 `seek=10` 也顺带避开片头标题卡。
- **Wikimedia 改用转码版**（`/transcoded/…/NAME.webm.1080p.vp9.webm`），原地址留着兜底（老文件不一定有转码版）；
  源比 480p 还小就直接用原文件。真机：50.5 MB → 28.4 MB。
- **Wikimedia 的 `duration` / `size` 一直有返回，之前没读**——所以 `minDuration` 对它一直是空转，
  也没法在下载前把整部纪录片挡掉。现在都读进候选，并默认挡掉超过 30 分钟的。

- **没开看图把关时，质检要说出来。** 真机跑免 key 路径时，"猫为什么总爱钻纸箱"配上了一段
  **黄蜂吃猫粮**的素材——`Wasp eating cat food` 标题里有 `cat`，字面匹配就过了。技术项全绿
  （字幕烧进画面、响度、时长、AI 标识都对）但画面是错的。试着调标题匹配的启发式后确认这条路走不通：
  `Wasp eating cat food` 和 `Lotti playing in a box` 对 "cat box" 各命中一个词，标题信息量根本不够。
  能分辨的只有看图排序。所以改成如实汇报：没配 vision 模型时，出片日志与质检各给一条
  「这 N 个镜头的画面只按检索词字面匹配选的，没经过看图把关，发之前自己过一遍」。
  README 的「谁来把关」一栏也补上这个前提。
- Wikimedia 标题相关性改为按命中词数排序（两个词都命中的排前面）——能区分时才起作用，不吹它能区分。
- 修：短剧第 4 步那句"单镜重出请用命令行（界面版 M2 后半段）"早就过时了——界面上就有按钮。

## [2.0.0-alpha.4] - 2026-08-30 · 成片"真的有字"：修免费路径上三个只在别人机器上炸的坑

真机复盘上一版案例时发现，免费路径的成片在 Mac 上默认是**没有可见字幕**的，且在 ffmpeg 6.x 上**没有声音**。都不是边角情况，是默认路径。

- **字幕烧不进画面（Mac 必现）**：Homebrew 现在的 `ffmpeg` formula 已经不再依赖 libass / freetype / fontconfig（`brew deps ffmpeg` 里没有它们），而 README 与 doctor 恰好让用户 `brew install ffmpeg`。后果不是"少个角标"：口播线找不到素材时会退纯色底、让字幕成为画面主体——烧不进去那一镜就是纯黑；软字幕轨抖音/视频号一律不认。
  - 新增 `openshorts install-ffmpeg` 与界面第 2 步同款按钮：装一份带 libass 的预编译 ffmpeg/ffprobe 到 `~/.openshorts/bin`（约 40 MB，只对开片生效，不动系统 ffmpeg），装完当场验 `subtitles` 滤镜在不在。
  - 所有 ffmpeg 调用统一走 `src/media/ffmpeg.mjs` 解析（环境变量 > 自己装的 > PATH）。
  - doctor 把"缺 libass"从 ⚠️ 升为 ⛔ 并说明后果；不再建议 `brew reinstall ffmpeg`（没用）。质检 `captions` 从 warn 升为 fail。
- **ffmpeg 6.x 上静默丢音轨**：分段渲染同时用 `-vf` 和 `-filter_complex`，在 ffmpeg 6.x 上退出码 0、无警告，输出里 audio 流声明还在但一个包都没有（Ubuntu 24.04 / Debian 12 默认就是 6.x；ffmpeg 8 恰好正常）。画面滤镜改到 `-filter_complex` 里，并在每段渲染后当场校验音频包数。加回归测试；CI 扩到 ubuntu / macOS / windows 三平台。
- **看图排序漏掉"唯一候选"**：只有 1 条候选时直接放行——而这恰恰是最容易混进标题卡的情况（案例里 s3 就是一段 1920 年代动画的英文标题卡）。改成 1 条也要打分；抽帧从固定第 1 秒改为**正片中段**（片头正是标题卡）。
- **字幕两处排版错**：ASS 样式预设按 1080 宽定，PlayResX 却直接写实际宽度，540 宽的项目用 64px 字直接顶出画外 → 按宽度等比缩放（角标同）；字幕按**镜头边界**断条，不再把"上一镜的尾巴 + 下一镜的开头"挤进同一条。
- **`sources` / doctor 不认 Wikimedia 兜底**：0 key 时素材库一律显示 ⛔，与"0 元 0 key 出片"自相矛盾。改为如实标"免 key 兜底可用，配 Pexels key 更贴合"。
- **素材缓存按 key 分桶**：以前 0 key 跑过一次后，即使新配了 Pexels key，同样的检索词 7 天内仍命中旧的 Wikimedia 缓存，"配了 key 画面更好"根本不生效。
- **健壮性**：Edge TTS 退避重试 3 次（非官方端点会抽）；每镜跑完就把项目写回盘（中途挂掉不用从头来）；素材下载加体积上限 / 超时 / 写 `.part` 再改名，第一条取不到就顺位试下一条；出片可取消（关页面即停），同一项目不能并发出片（返回 409）。
- 批量出片现在也走看图排序（此前漏传 `vision`，批量版本可能用上主流程已判退的素材）。

## [2.0.0-alpha.3] - 2026-08-30 · M3 批量 / 发布包 / 英文切换
- 批量出版本：同脚本 × 音色 × 字幕样式 × 语速，串行出片，产物 `variants/<id>/`；CLI `openshorts batch`、API SSE、界面第 4 步多选。
- 发布包：抖音 / 视频号 / B 站 / YouTube Shorts 四套规格（标题字数、标签数、AI 标识提示），一键生成目录 + zip（mp4、封面、SRT、发布文案含素材署名与质检摘要）；CLI `openshorts export`。不自动发布。
- 英文界面切换（顶栏 EN/中，`?lang=en`）；链接输入；本地草稿档一键安装（sd-cli 预编译包 + 模型断点续传 + 许可证门）；供应商/模型下拉来自 AO 供应商表。
- 服务端模块可加载测试（防漏提交）。

## [2.0.0-alpha.2] - 2026-08-30 · M2 AI 短剧进界面 + 本地草稿档
- **单镜重出**：每镜卡片「按验收意见重出」「提意见 / 换来源（本地草稿档 ↔ 云端成片档）」，走 AO `--resume <上次运行> --from <镜> --feedback`；真机：只重跑 shot3（457 s）+ 合成，其余复用，项目记 `redoHistory`。引擎非 0 退出不回填项目。
- 四步界面加「AI 短剧」线：故事 / 题材 / 风格 / 画幅 → 档位（本地草稿档 · 不花钱 / 云端成片档 · 按秒计费）→ 花费预览（按所选输入算）→ 确认花费出片（AO 子进程，stdout 逐行转 SSE）→ 成片 + 定妆图 + 三镜卡片（每镜验收结论与未满足项）。
- 本地草稿档依赖 AO 新增的视频供应商 `local-sdcpp`（本机 stable-diffusion.cpp + MiniMax-H3 GGUF；串行、不联网、不花钱）。真机（M2 Max 32 GB）：定妆图 Agnes 29 s 验收通过，三镜本地各 2.33 s 共约 21 分钟，合成 7 秒成片，全程 0 元；画质如 ADR-004 所述是 2-bit 草稿级，只用于验证方向。
- README 快速开始改为 v2 用法。需要 AO ≥ 0.19.2（未发版前用 `npm link ../agency-orchestrator`）。

## [2.0.0-alpha.1] - 2026-08-30 · M1 口播科普（免费路径跑通）
- **出片后自动质检 + `openshorts doctor`**：质检报分辨率/时长偏差/音轨/EBU R128 响度/字幕（软轨只算提醒）/封面/AI 标识/镜头就绪，结果进项目 JSON 与界面第 4 步；真机抓到 Edge TTS 成片 -23 LUFS 偏轻 → 合成加 `loudnorm` 归一到 -16（实测 -17.6）。doctor 体检 ffmpeg 与 libass/drawtext/ebur128、中文字体、`ulimit -n`、输出目录、whisper、四种来源，再转 AO doctor。
- **四步界面「开片」成为默认入口**（`/`；v1 图层动画编辑器移到 `/editor`）：① 输入（内容线 / 话题 / 时长 / 语气，无文本 key 时指路）② 来源与花费（四种来源可用性卡片、素材库 key 引导、本地素材夹、音色试听、字幕预设、花费 0 元说明）③ 预览与调整（每镜文案 / 画面意图 / 检索词可改，出片日志实时）④ 出片与发布（播放器、下载 mp4/SRT/封面、标题点击复制、话题、发布说明、素材署名、降级提示）。后端 `server/kaipian.mjs`：`/api/kaipian/*`（sources / config / voices / tts/preview / new / projects / run(SSE) / file）。
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
