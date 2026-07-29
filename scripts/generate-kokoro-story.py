#!/usr/bin/env python3
"""使用本机 Kokoro-82M 缓存离线生成分镜旁白。"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from kokoro import KModel, KPipeline
from pypinyin import load_phrases_dict


def duration(file: Path) -> float:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(file)
    ], check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--story", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--voice", default="")
    parser.add_argument("--speed", type=float, default=0.0,
                        help="固定语速；0 表示自动（v1.1-zh 按句长自适应，v1.0 为 1.08）")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    root = Path.cwd()
    story = json.loads(Path(args.story).read_text(encoding="utf-8"))
    output = Path(args.output).resolve()
    model_dir = Path(args.model_dir).resolve()
    config = model_dir / "config.json"
    if (model_dir / "kokoro-v1_1-zh.pth").exists():
        weights = model_dir / "kokoro-v1_1-zh.pth"
        repo_id = "hexgrad/Kokoro-82M-v1.1-zh"
        voice_name = args.voice or "zf_001"

        # v1.1-zh 官方推荐：短句用原速，长句逐渐放慢，避免长句发糊。
        def auto_speed(len_ps: int) -> float:
            speed = 0.8
            if len_ps <= 83:
                speed = 1
            elif len_ps < 183:
                speed = 1 - (len_ps - 83) / 500
            return speed * 1.1

        speed = args.speed or auto_speed
    else:
        weights = model_dir / "kokoro-v1_0.pth"
        repo_id = "hexgrad/Kokoro-82M"
        voice_name = args.voice or "zf_xiaoxiao"
        speed = args.speed or 1.08
    voice = model_dir / "voices" / f"{voice_name}.pt"
    for file in (config, weights, voice):
        if not file.exists():
            raise FileNotFoundError(f"缺少本地 Kokoro 文件：{file}")

    pronunciations = story.get("pronunciations", {})
    for term, syllables in pronunciations.items():
        if not term or not isinstance(syllables, list) or len(syllables) != len(term):
            raise ValueError(f"读音词典格式无效：{term} -> {syllables}")
    if pronunciations:
        load_phrases_dict({term: [[syllable] for syllable in syllables]
                           for term, syllables in pronunciations.items()})
        print(f"已加载 {len(pronunciations)} 条项目读音覆盖：{', '.join(pronunciations)}", flush=True)

    output.mkdir(parents=True, exist_ok=True)
    print("加载本地 Kokoro-82M 模型…", flush=True)
    model = KModel(repo_id=repo_id, config=str(config), model=str(weights)).to("cpu").eval()
    pipeline = KPipeline(lang_code="z", repo_id=repo_id, model=model, device="cpu")
    timings = []
    pending = []
    cursor = 0.0
    segments = story["segments"][: args.limit or None]
    staging_context = tempfile.TemporaryDirectory(prefix="papercut-kokoro-")
    staging = Path(staging_context.name)
    for index, segment in enumerate(segments):
        basename = f"{index + 1:02d}-{segment['id']}"
        final_target = output / f"{basename}.wav"
        target = staging / f"{basename}.wav"
        chunks = []
        for result in pipeline(segment["text"], voice=str(voice), speed=speed, split_pattern=r"(?<=[。！？；])"):
            if result.audio is not None:
                chunks.append(result.audio.numpy())
                chunks.append(np.zeros(int(24000 * 0.12), dtype=np.float32))
        if not chunks:
            raise RuntimeError(f"Kokoro 未生成音频：{basename}")
        audio = np.concatenate(chunks)
        sf.write(target, audio, 24000, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(target),
                        "-af", "loudnorm=I=-16:LRA=7:TP=-1.5", "-ar", "48000", "-ac", "1",
                        str(target.with_suffix(".normalized.wav"))], check=True)
        target.with_suffix(".normalized.wav").replace(target)
        seconds = duration(target)
        if target.stat().st_size < 1000 or seconds <= 0.2:
            raise RuntimeError(f"Kokoro 生成了无效音频：{target}")
        start = round(cursor, 3)
        seconds = round(seconds, 3)
        end = round(start + seconds, 3)
        timings.append({**segment, "index": index, "file": str(final_target.relative_to(root)),
                        "provider": "kokoro-local", "start": start,
                        "end": end, "duration": seconds})
        pending.append((target, final_target))
        cursor = end
        print(f"  ✓ {basename}: {seconds:.2f}s", flush=True)

    payload = {"storyId": story["id"], "voice": voice_name, "model": repo_id, "provider": "kokoro-local",
               "speed": args.speed or "auto", "pronunciations": pronunciations,
               "totalDuration": round(cursor, 3), "segments": timings}
    for staged, final in pending:
        staged.replace(final)
    timing_target = output / "timings.json"
    timing_pending = output / ".timings.json.pending"
    timing_pending.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    timing_pending.replace(timing_target)
    staging_context.cleanup()
    print(f"✓ 离线旁白完成：{len(timings)} 段，共 {cursor:.2f}s", flush=True)


if __name__ == "__main__":
    main()
