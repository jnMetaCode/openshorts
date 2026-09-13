# 推广工作台（2026-09-11 起）

> 原则沿用 `docs/v2/05-发布与增长计划.md`：不买星、不刷 Trending、只挂真机跑通的供应商。
> 这里是**可执行清单 + 现成文案**。已自动化的部分不用人管；打 ✋ 的只有账号主人能做。

## 已经自动的
- **官网 SEO / AI 入口**：`website/robots.txt`、`sitemap.xml`（中英 hreflang）、`llms.txt`、两页 JSON-LD（SoftwareApplication）、canonical → https://os.aiolaola.com。改 `website/` 后 `npx wrangler deploy` 即上线。
- **AI Agent 一句话安装**：`docs/skill/SKILL.md`（README 与官网都放了那两行话）。用户把它发给 Claude Code / Codex，Agent 自己装、体检、出片。这是 MoneyPrinterTurbo 2026 年新加的入口，我们照做但用的是 Node，不用装 Python。
- **发版即广播**：`.github/workflows/announce.yml` — Release 发布后把"版本名 + 说明前三行 + 链接"发到已配置的渠道。**没配 Secrets 时什么都不发、不会红**。

## ✋ 只有你能做（按收益排）
1. **npm 首发** `npm login && npm publish` → 之后 README / 官网 / SKILL.md 的安装命令全部改成一行 `npx openshorts`（AI 来改）。所有推广落点都指向它，先发这个。
2. **姊妹仓顶部导流**：`agency-agents-zh`（20.5k★）和 `superpowers-zh`（8k★）是全家最大的流量入口，但 openshorts 只出现在它们 README 底部的姊妹表里。在它们 README 顶部加一行（文案见下"姊妹仓一句话"），比任何外部渠道都值。`local-agent-toolkit` 目前完全没提 openshorts，补进姊妹表。
3. **GitHub 仓库主页字段**：`gh repo edit jnMetaCode/openshorts --homepage https://os.aiolaola.com`（现在指向 docs/v2）。
4. **广播渠道 Secrets**（任选，配一个就开始自动发）：Bluesky `BSKY_IDENTIFIER` + `BSKY_APP_PASSWORD`；Telegram `TG_BOT_TOKEN` + `TG_CHAT_ID`；Mastodon `MASTODON_INSTANCE` + `MASTODON_TOKEN`；X `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET`。配好后在 Actions 页手动跑一次 `Announce release` 填一句话试发。
5. **搜索引擎登记**：Google Search Console 与 Bing Webmaster 提交 `https://os.aiolaola.com/sitemap.xml`；Cloudflare 后台给 os.aiolaola.com 开 Web Analytics（免费、无 cookie）。
6. **赞助位**：秘塔 / 火山 / APIMart 洽谈稿在 `/Users/yx/work/战略/赞助洽谈-*.md`。谈成一家就上 README 顶部，链接带 `?s=openshorts`。MPT 的 README 前 150 行有 114 行是赞助商——每家赞助商都在自己渠道推它。
7. **awesome 列表投稿**（PR，各 5 分钟）：
   - `awesome-ai-video`（搜 GitHub 同名仓，挑 star 最高的）→ 一行：`[OpenShorts](https://github.com/jnMetaCode/openshorts) - Local-first short-video pipeline: topic → script → footage/on-device frames → TTS → captions → mp4. Free path costs $0, no Python.`
   - `awesome-chinese-llm` / `awesome-LLM-resources`（中文）→ 「开片 OpenShorts：本地优先的短视频生产线，话题进成片出，免费路径 0 元 0 key，AI 短剧支持本机出片」
   - `awesome-remotion`（v1 图层动画编辑器基于 Remotion）
   - `awesome-ffmpeg` / `awesome-video`
8. **首发帖**：文案在本目录，按 05 文档节奏：npm 发完 +3 天中文（知乎 / 掘金 / V2EX / 即刻 / 公众号），再 +3 天英文（Show HN / r/LocalLLaMA / r/StableDiffusion / X）。

## 姊妹仓一句话（贴到各仓 README 顶部徽章下面）
- 中文：`🎬 同作者新作：[开片 OpenShorts](https://github.com/jnMetaCode/openshorts) —— 话题进，成片出：脚本 / 配音 / 字幕 / 成片 / 发布包一条龙，免费路径 0 元 0 key，本地优先。`
- 英文：`🎬 New from the same author: [OpenShorts](https://github.com/jnMetaCode/openshorts) — topic in, publish-ready short video out; free path costs $0, local-first, no Python.`
- `ai-shortfilm-prompts` 专用（它讲的是提示词写法，开片是把提示词变成片的地方）：`想把这套五段式提示词直接出成片？[开片 OpenShorts](https://github.com/jnMetaCode/openshorts) 的 AI 短剧线接了 Seedance / MiniMax-H3 / Sora / 可灵，一段故事 → 三镜成片，本机草稿档 0 元。`

## 指标（公开可查，不埋点）
GitHub star / fork / Discussions 晒片数 · npm 周下载 · os.aiolaola.com 的 Cloudflare Web Analytics · 官方账号示例片播放。基线 2026-09-11：openshorts 7★（MPT 122k、NarratoAI 11k、VideoLingo 18k）。
