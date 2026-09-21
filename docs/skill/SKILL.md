---
name: openshorts-video
description: Use this skill whenever the user wants a finished short video (talking-head explainer, opinion piece, product pitch, or an AI mini-drama) from a topic, article link, or script, using OpenShorts (Kaipian, github.com/jnMetaCode/openshorts — not the unrelated clip generator at openshorts.app). It installs OpenShorts locally, writes the script with the user's own text model, picks free stock footage or paints frames on-device, synthesizes the voice-over with free Edge TTS, burns captions, renders a 1080×1920 mp4 with cover, SRT and publish copy, and returns the file paths. Default path costs ¥0 / $0.
compatibility: Needs an AI agent with terminal, network and filesystem access. Node.js 20+ and git. macOS, Linux and Windows. Uses `npm`; no Python.
metadata:
  author: "jnMetaCode"
  version: "2.0.0-alpha.23"
  upstream: "https://github.com/jnMetaCode/openshorts"
  homepage: "https://os.aiolaola.com"
---

# OpenShorts — make a short video from one sentence

The user gives a topic, an article URL, or a script. You do everything else: install, health-check, script, footage, voice, captions, render, publish pack. Deliver file paths at the end. Do not stop after explaining the steps.

## Required behavior

1. Ask the user for at most one thing, once: an API key for a text model (DeepSeek / Kimi / GLM / OpenAI-compatible…) **only if** `openshorts new` reports a missing key. Everything else (footage, voice, rendering) is free and needs no key.
2. Do not ask for confirmation before installing, running `doctor`, installing the bundled ffmpeg, or rendering. Send one short progress line, then execute.
3. Run long commands in the foreground with a timeout of at least 15 minutes. Do not poll with `sleep` / `ls` loops.
4. On failure read only the last 30 lines of output; OpenShorts prints the real cause (missing libass, missing key, quality-check items), not just an exit code.
5. Never print API keys or the contents of `~/.ao` / `~/.openshorts/config.json`.

## Defaults

Unless the user says otherwise: Chinese talking-head explainer, 60 s, 1080×1920, free Edge TTS voice, Wikimedia Commons / Pexels footage, captions burned in, AI-content label on. Output goes to `~/OpenShorts/<project>/`. For English use `--lang en` (script, voice and caption line-breaking switch together).

## Execution

### 1. Install (once)

```bash
node -v                      # must be >= 20
git clone https://github.com/jnMetaCode/openshorts.git ~/openshorts
cd ~/openshorts && npm install
```

(Once the npm package is published, `npx openshorts …` replaces the clone. Check the README's first code block.)

### 2. Health check — do not skip

```bash
node bin/openshorts.mjs doctor
```

If it says ffmpeg lacks **libass** (captions cannot be burned in — Homebrew's ffmpeg has this problem), run:

```bash
node bin/openshorts.mjs install-ffmpeg     # ~40 MB, pinned build with sha256 check, installed to ~/.openshorts/bin only
```

### 3. Write the script

```bash
node bin/openshorts.mjs new koubo-kepu --topic "<topic or full script>"            # Chinese
node bin/openshorts.mjs new --lang en --topic "<topic or full script>"             # English
```

Add `--local-dir <folder>` to prefer the user's own footage, `--voice <id>` to pick a voice (`npm run voices` lists them). If the command reports a missing text-model key, ask the user for one key, then configure it once:

```bash
DEEPSEEK_API_KEY=<key> node bin/openshorts.mjs new koubo-kepu --topic "<topic>"   # any provider the engine knows: DEEPSEEK_API_KEY / MOONSHOT_API_KEY / OPENAI_API_KEY …
```

The command prints the project path: `~/OpenShorts/<project>/project.json`.

### 4. Estimate, render, pack

```bash
node bin/openshorts.mjs estimate ~/OpenShorts/<project>/project.json   # cost is ¥0 on the default path; tells the expected wait
node bin/openshorts.mjs run      ~/OpenShorts/<project>/project.json   # footage → voice → captions → mp4 + quality check
node bin/openshorts.mjs export   ~/OpenShorts/<project>/project.json --platform douyin   # or shorts / bilibili / channels
```

`run` reuses finished shots on re-runs; `run … --only s2` redoes one shot. `openshorts rm <project.json> --yes` deletes a project the user no longer wants (ask first — it removes the whole folder). If `run` ends with quality-check ⛔ items, report them verbatim to the user instead of calling it done.

## Exit handling

On success `run` prints:

```text
✓ 成片：/Users/…/OpenShorts/<project>/<project>.mp4（58.3s，出片用时 47 秒）
  字幕：…/<project>.srt
  封面：…/<project>-cover.jpg
  发布文案：…/<project>-发布文案.txt
```

Return those four paths plus the publish pack directory from `export`. If the output contains `⛔`, return the message as-is and stop; do not retry blindly.

## Notes for the agent

- Everything runs on the user's machine; no video is uploaded anywhere. Only the script step calls the user's own text-model API.
- `openshorts drama --plan -i story="…"` previews the cost of an AI mini-drama before spending anything; only run `drama` without `--plan` after the user has seen the estimate.
- Web UI alternative: `npm run openshorts` opens http://127.0.0.1:4174 (the same pipeline, four steps).
