# English launch posts

## Show HN (title ≤ 80 chars)

**Title:** Show HN: OpenShorts – local-first short-video pipeline, topic in, mp4 out, $0 default

**Body:**
I built OpenShorts after two months with MoneyPrinterTurbo (120k stars, Python). Three things bugged me: stock-footage misses (asked for "why cats love boxes", got a brass bell), the Python setup for non-dev friends, and paying for AI video before knowing the price.

OpenShorts is Node (no Python), MIT. Give it a topic, an article URL or a script → script, footage, voice-over (free Edge TTS), burned-in captions, 1080×1920 mp4 + cover + SRT + publish copy. The default path costs $0; the only key you need is your own text model.

What's different:
- When stock has nothing, it paints a frame on-device (FLUX.1-schnell on stable-diffusion.cpp, ~57 s on an M2 Max) instead of a solid color.
- Optional vision check: a model scores one frame of each candidate clip and rejects off-topic ones.
- Cost and wait time are printed before you run; the AI mini-drama line quotes per shot per provider, with a free on-device draft tier (MiniMax-H3 GGUF).
- Per-shot redo; everything else is reused by fingerprint.
- Post-render quality gate (resolution / duration / audio track / loudness / captions / AI label) — exit 1 on failure, because ffmpeg 6 silently drops audio tracks and Homebrew's ffmpeg can't burn subtitles.

Repo: https://github.com/jnMetaCode/openshorts · Site: https://os.aiolaola.com/en/
Every sample video in the README was rendered by it; the case pages say which shots are bad and why.

## Reddit r/LocalLLaMA / r/StableDiffusion

**Title:** OpenShorts: open-source short-video generator that paints missing footage on-device with sd.cpp (FLUX schnell) and previews cost before spending

**Body (short):**
Local-first, Node, MIT. Topic → script (your own LLM key) → CC footage or on-device FLUX frames → free Edge TTS → captions → 1080×1920 mp4. AI mini-drama line has a $0 draft tier running MiniMax-H3 GGUF through stable-diffusion.cpp (24 GB RAM+), plus cloud tiers (Seedance / MiniMax-H3 API / Sora / Kling) with per-shot cost preview. `openshorts doctor` tells you what your machine can run. Repo + real samples: https://github.com/jnMetaCode/openshorts

## X / Bluesky thread (3 posts)

1/ OpenShorts: topic in → publish-ready short video out. Local-first, MIT, no Python. Free path costs $0 (Edge TTS + CC footage + your ffmpeg). https://os.aiolaola.com/en/
2/ When stock footage misses, it paints the frame on-device (FLUX schnell via sd.cpp). A vision model can reject off-topic clips before render. Cost & wait time shown before you run.
3/ Hand it to your AI agent and walk away: "Use this skill: https://raw.githubusercontent.com/jnMetaCode/openshorts/main/docs/skill/SKILL.md — make me a 60s explainer about X". Repo: https://github.com/jnMetaCode/openshorts
