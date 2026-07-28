# TTS 方案

## 默认方案：Edge TTS

PaperCut Studio 的故事案例复用 `youtube-doodle/make-doodle.js` 已验证的工作方式：逐镜调用 `edge-tts`、缓存结果、用 ffprobe 验证真实时长，再重建镜头节奏。

```bash
pipx install edge-tts
npm run story:audio
npm run story:render:fallback
```

默认音色为 `zh-CN-YunjianNeural`。可直接调整：

```bash
node scripts/generate-macos-story-audio.mjs \
  --story=content/lychee-road/story.json \
  --output=public/audio/lychee-road \
  --provider=edge --voice=zh-CN-YunxiNeural --rate=+4% --pitch=-3Hz
```

`edge-tts` 的客户端开源且不要求 API Key，但语音生成依赖微软在线服务。离线或受限网络环境无法使用。

## 完全离线方案

- CosyVoice：Apache-2.0，中文自然度、情绪控制和零样本音色能力更适合正式成片，但模型较大。
- Kokoro/MLX：Apache-2.0、模型更轻，适合 Apple Silicon 本地推理，中文音色选择少于 CosyVoice。
- Piper：完全本地且速度快，但新版为 GPL-3.0，中文模型和商业分发需要单独评估。

本项目不会自动下载大型模型。离线引擎只需最终按镜头写出 `public/audio/<项目>/<镜头>.wav`，再生成同结构的 `timings.json`，渲染器无需修改。

如果本机已经安装 `kokoro`、`misaki[zh]`、PyTorch 和 SoundFile，并缓存 Kokoro-82M 模型，可直接运行：

```bash
npm run story:audio:local
npm run story:render:fallback
```

自动发现失败时可显式指定：

```bash
PAPERCUT_KOKORO_PYTHON=/path/to/venv/bin/python \
PAPERCUT_KOKORO_MODEL_DIR=/path/to/Kokoro-82M \
npm run story:audio:local
```
