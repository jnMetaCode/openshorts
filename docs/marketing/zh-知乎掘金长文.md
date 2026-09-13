# 我把 MoneyPrinterTurbo 的路线做成了本地优先版：开片 OpenShorts

> 目标平台：知乎 / 掘金 / 公众号。约 1500 字。配图：README 顶部的 2×2 成片墙 + 界面三张截图 + `openshorts doctor` 输出截图。发布前把"npm 包即将发布"改成实际状态。

MoneyPrinterTurbo 有 12 万星，我也是它的用户。用了两个月，我攒下三条抱怨：

1. **素材库没命中就完蛋。** 说"猫为什么钻纸箱"，它给我配了一口铜钟——检索词字面匹配，没人把关。
2. **要装 Python 环境。** 给做内容的朋友装一次，光解决 `faster-whisper` 和 ffmpeg 就一个晚上。
3. **想用 AI 出片就要花钱，而且花之前不知道要花多少。**

于是有了「开片 OpenShorts」——一条本地优先的短视频生产线，MIT 开源。这篇说它跟 MPT 路线的差别在哪，以及哪些是我踩坑踩出来的。

## 一句话是什么

给一个话题、一篇文章链接或一段文案，它写脚本、找画面、配音、烧字幕、出 1080×1920 成片 + 封面 + SRT + 发布文案。**默认路径 0 元 0 key**：Edge TTS 免费、Wikimedia Commons / Pexels 的 CC 素材免费、合成用本机 ffmpeg。写脚本那一步用你自己的文本模型（DeepSeek / Kimi / GLM 都行，配一次）。

```bash
git clone https://github.com/jnMetaCode/openshorts.git && cd openshorts && npm install
npm run openshorts        # 四步界面，http://127.0.0.1:4174
```

## 三处和 MPT 不一样的地方

**1. 素材库没命中时，本机现画一张，而不是退纯色底。**
装一个 FLUX.1-schnell（Apache-2.0，6.4 GB），跑在 stable-diffusion.cpp 上，M2 Max 约 57 秒一张。真实案例《指南针指的真不是正北》：7 镜里 5 镜的素材被看图把关退回，改本机现画——成片在 README 里，点进去能看每一镜是怎么来的。

**2. 看图把关。**
配一个能看图的模型（可选），每条候选素材抽一帧打分，不贴题的退回。就是这一步拦下了那口铜钟。

**3. 花多少钱、等多久，运行前就告诉你。**
`openshorts estimate` 报时间；AI 短剧线 `openshorts drama --plan` 按供应商报价逐镜列出来，界面上要点"确认花费"才真跑。短剧线三档：本机草稿（0 元，MiniMax-H3 GGUF）/ 云端成片（秘塔 / 火山 Seedance / APIMart）/ 混用。

## 踩坑踩出来的几条

- **Homebrew 的 ffmpeg 已经不含 libass**——字幕烧不进画面，成片传到抖音是没字的。`openshorts doctor` 会查，`install-ffmpeg` 装一份带 libass 的到 `~/.openshorts/bin`，钉死版本 + sha256 校验，不动系统 ffmpeg。
- **ffmpeg 6.x 会静默丢音轨**（退出码 0）。所以出片后有质检：分辨率 / 时长 / 音轨 / 响度 / 字幕 / 封面 / AI 标识，不过就 ⛔ 退出码 1，不给你一条"看起来成功了"的片。
- **重出一镜不该重做整条。** `run --only s2` 只重出第 2 镜，其余按指纹复用，配音也不重合成。
- **出片跑到一半刷新页面不该作废。** 任务在服务端自己跑，页面断了重连接着看（这周刚修的）。

## 它不做什么

不内置共享 key、不上传你的素材、不自动发布（发布包是草稿）。每条成片带 AI 生成标识，素材署名写进发布文案。

## 现状

alpha，三平台 CI，248 条测试，桌面版（mac / win / linux）在 Releases。README 里四条成片全是它真出的，案例页连"哪一镜不够好、为什么"都写着。

仓库：https://github.com/jnMetaCode/openshorts · 官网：https://os.aiolaola.com

如果你也在用 MPT，欢迎来 Discussions 晒片、提模板。
