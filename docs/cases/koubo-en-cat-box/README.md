# Case: "Why cats squeeze into cardboard boxes" — the English pipeline, end to end

> Actually produced by OpenShorts (talking-head line) with `--lang en`. **The first English film made
> by this project.** Script, voice, captions, quality notes and the publish pack are all English;
> the only paid thing is the text model that wrote the script (a few cents, your own key).
> 中文读者：这是英文成片线的案例，页面用英文写——它服务的就是英文读者。
> 中文案例见 [《为什么切洋葱会流眼泪》](../koubo-onion/) 与 [《指南针指的真不是正北》](../koubo-compass/)。

![preview](en-cat-box-9s.gif)

[Watch the full film (56 s, 1080×1920, compressed)](../../../website/assets/en-cat-box.mp4) · [SRT](en-cat-box.srt)

```bash
openshorts new --lang en --topic "why cats squeeze into cardboard boxes" --duration 45秒
openshorts run ~/OpenShorts/why-cats-squeeze-into-cardboard-boxes/project.json
```

## What the English switch actually changes

Four things were hard-coded to Chinese before this case existed. Each one is a real defect you
only see by making a film, not by reading code:

| | Chinese | English |
|---|---|---|
| **Caption assembly** | glue characters together (`join('')`) | join on spaces — otherwise you get `Whydocatslove` |
| **Line wrapping** | break at any character | break only at word boundaries — otherwise `cardboard bo / xes` |
| **Length ruler** | 4.5 characters/second | **2.9 words/second** — measured here, not guessed (see below) |
| **Voice** | `zh-CN-XiaoxiaoNeural` | `en-US-AvaNeural`; a Chinese voice never carries into an English film |

The 2.9 words/second figure comes from running the same 61-word paragraph through eight English
Edge TTS voices on one machine: 2.67 (en-AU-Natasha) to 3.09 (en-US-Andrew), median 2.9. The
template's word-count targets are derived from it, and a test fails if the constant and the
template ever drift apart.

## The script the model wrote

Target was 45 seconds. It came back **135 words ≈ 47 s** — inside the ±10% band, so no rewrite
was triggered. The finished film is 55.6 s because the voice-over is only part of each shot's
runtime.

| shot | words | visual | narration (opening) |
|---|---|---|---|
| hook | 8 | stock | *Why do cats obsessively squeeze into cardboard boxes?* |
| s1 | 16 | local FLUX | *Cats seek confined spaces for warmth, and cardboard insulates…* |
| s2 | 22 | stock | *Wild ancestors hid in burrows to escape predators…* |
| s3 | 22 | local FLUX | *Boxes also provide the perfect hunting blind…* |
| s4 | 21 | stock | *When stressed, cats retreat to small spaces to calm down…* |
| s5 | 25 | local FLUX | *Next time you see this behavior, do not laugh…* |
| outro | 21 | local FLUX | *So the next time your cat claims a delivery box, leave it be…* |

Titles it proposed: *Why Cats Love Cardboard Boxes Will Blow Your Mind* · *The Real Reason Your
Cat Obsesses Over Boxes* · *Cats in Boxes: The Science Behind the Obsession*.
Tags: `catsoftiktok catfacts petbehavior box cats`.

## Where the pictures came from — honestly

**Three of seven** shots got real footage that passed the visual check. **Four were painted on this
machine** by FLUX.1-schnell because stock had nothing usable. That is the designed behaviour, not a
failure: the visual check scores each candidate against the shot's intent and anything below the bar
falls back to local generation rather than putting a wrong picture on screen.

One thing worth knowing if you reproduce this: on the machine used here the vision endpoint was
**rate-limited** (HTTP 429, free tier exhausted) for part of the run, so several shots could not be
scored at all. When that happens the engine says so and generates locally — it does **not** quietly
use an unvetted clip. You will see notes like *"not one candidate could be judged (the vision
endpoint did not answer) — generated locally instead of using an unvetted clip"*.

**Footage credits** (required by the CC licences)

| shot | licence | source · author |
|---|---|---|
| hook | Public domain | Wikimedia Commons · me |
| s2 | CC0 1.0 | Openverse · themet |
| s4 | CC BY 2.0 | Openverse · Rocky Mountain Feline Rescue |
| s1, s3, s5, outro | Apache-2.0 | generated locally with FLUX.1-schnell |

## Automatic quality check (its own words, in English)

```
1080×1920 (expected 1080×1920)
Video is 55.6s, shot voice-overs total 55.6s (0% off)
aac 96000Hz
Integrated loudness -16.5 LUFS (target -16 ±3)
Captions are burned into the picture
cover image present
Metadata carries the AI-generated label
7/7 shots ready
4 shots were generated on this machine (not retrieved) — keep the AI label when you publish
3 shots had their footage vetted by visual ranking
```

## The publish pack is English too

`openshorts export <project.json> --platform shorts` writes an English folder — file names, labels,
platform rules and the quality summary. The one thing deliberately **not** translated is the
platform's own back-office rules for Chinese platforms: translating "标题 ≤ 55 字" would stop
matching what the uploader actually shows you.

## What is still Chinese

The `openshorts` CLI prints its own progress and errors in Chinese, and live log lines coming from
the AO engine subprocess are Chinese too. The AI mini-drama line runs on a Chinese workflow, so its
script is Chinese regardless of this switch. The **film** and everything shipped with it — captions,
SRT, cover, publish copy, credits, quality notes — are English.
