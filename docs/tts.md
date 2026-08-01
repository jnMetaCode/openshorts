# TTS 方案

## 默认方案：Edge TTS

PaperCut Studio 的故事案例复用 `youtube-doodle/make-doodle.js` 已验证的工作方式：逐镜调用 `edge-tts`、缓存结果、用 ffprobe 验证真实时长，再重建镜头节奏。

```bash
pipx install edge-tts
npm run story -- lychee-road audio
npm run story -- lychee-road render --fallback
```

音色写在 `content/<故事名>/storyboard.json` 的 `voice` 块，两条内置故事当前使用 `zh-CN-YunyangNeural`、`+0%` 语速：

```json
"voice": {"name": "zh-CN-YunyangNeural", "rate": "+0%", "pitch": "+0Hz"}
```

试听候选或临时覆盖：

```bash
npm run voices                                              # 同一句话，多个音色各念一遍
npm run story -- lychee-road audio --voice=zh-CN-YunxiNeural --rate=-5%
```

语速为负时必须写成 `--rate=-5%`，否则负号会被当成命令行标志。

各音色的微软官方定位：`YunyangNeural` 新闻播报（专业可靠）、`YunxiNeural` 小说朗读（年轻明快）、`YunjianNeural` 体育解说（激情）、`XiaoxiaoNeural` 女声（温暖）。讲解类内容选错定位是「听着不对味」最常见的原因——早先默认的 `YunjianNeural` 就属于体育解说定位。

读音词典仅约束 Kokoro 链路，Edge 由微软引擎原生断词。

`edge-tts` 的客户端开源且不要求 API Key，但语音生成依赖微软在线服务。离线或受限网络环境无法使用。

## 完全离线方案

- CosyVoice：Apache-2.0，中文自然度、情绪控制和零样本音色能力更适合正式成片，但模型较大。
- Kokoro/MLX：Apache-2.0、模型更轻，适合 Apple Silicon 本地推理，中文音色选择少于 CosyVoice。
- Piper：完全本地且速度快，但新版为 GPL-3.0，中文模型和商业分发需要单独评估。

本项目不会自动下载大型模型。离线引擎只需最终按镜头写出 `public/audio/<项目>/<镜头>.wav`，再生成同结构的 `timings.json`，渲染器无需修改。项目可通过 `soundtrackVolume` 统一控制网页预览和 FFmpeg 成片的配乐音量，避免两条渲染链路听感不一致。

如果本机已经安装 `kokoro`、`misaki[zh]`、PyTorch 和 SoundFile，并缓存 Kokoro-82M 模型，可直接运行：

```bash
npm run story -- lychee-road audio:local
npm run story -- lychee-road render --fallback
```

只检查本机环境和模型是否可用（不生成音频）：

```bash
node scripts/run-local-kokoro.mjs --check
```

脚本会检查当前项目、`PATH`、常见虚拟环境目录和 `~/work` 下的 Python 虚拟环境，并验证其能实际导入 `kokoro`、`numpy` 和 `soundfile`。模型会从项目目录、Hugging Face/ModelScope 常见缓存位置中发现，不再依赖开发者机器的绝对路径。
发现器同时支持 Kokoro-82M v1.0 和中文专用的 `Kokoro-82M-v1.1-zh`；两者都存在时优先使用 v1.1-zh。本仓库的 `models/Kokoro-82M-v1.1-zh/`（已 gitignore）是首选放置位置，至少需要 `config.json`、`kokoro-v1_1-zh.pth` 和 `voices/zf_001.pt`。
v1.1-zh 默认音色 `zf_001`，语速按官方建议自适应：短句原速、长句逐渐放慢；`--speed` 传非零值可固定语速。v1.0 只有实验性中文支持（`zf_xiaoxiao`），听感明显生硬，不再推荐用于成片。

音色试听：`out/voice-samples/` 下有四个 Edge 音色的首段样本，以及 v1.1-zh 的 `zf_001` 全片、`zm_010` 首段离线对比版，试听后换音色只需改 `--voice` 重新生成。

中文专名或多音字可在故事 JSON 顶层声明项目级读音词典，注音仅影响 TTS，不会改变字幕和原文：

```json
{"pronunciations": {"子午谷": ["zi3", "wu3", "gu3"]}}
```

若本机已安装 `faster-whisper` 并缓存模型，可对最终成片执行离线反向识别：

```bash
npm run story:asr:local
```

报告写入 `out/quality/asr-report.json` 和 `asr-report.md`。默认只要求识别为中文、语言概率不低于 0.9 且有有效分段；不将小模型的同音错字当作 TTS 失败。自动发现失败时可设置 `PAPERCUT_WHISPER_PYTHON` 和 `PAPERCUT_WHISPER_MODEL`。

完整的本地发布链路可一次完成渲染、原子更新正式成片、双验收和 SHA-256 清单：

```bash
npm run story:release:local
```

自动发现失败时可显式指定：

```bash
PAPERCUT_KOKORO_PYTHON=/path/to/venv/bin/python \
PAPERCUT_KOKORO_MODEL_DIR=/path/to/Kokoro-82M \
npm run story -- lychee-road audio:local
```
