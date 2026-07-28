#!/usr/bin/env python3
"""使用本机 Kokoro-82M 缓存离线生成分镜旁白。"""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
import soundfile as sf
from kokoro import KModel, KPipeline


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
    parser.add_argument("--speed", type=float, default=1.08)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    root = Path.cwd()
    story = json.loads(Path(args.story).read_text(encoding="utf-8"))
    output = Path(args.output).resolve()
    model_dir = Path(args.model_dir).resolve()
    config = model_dir / "config.json"
    weights = model_dir / "kokoro-v1_0.pth"
    voice = model_dir / "voices" / "zf_xiaoxiao.pt"
    for file in (config, weights, voice):
        if not file.exists():
            raise FileNotFoundError(f"缺少本地 Kokoro 文件：{file}")

    output.mkdir(parents=True, exist_ok=True)
    print("加载本地 Kokoro-82M 模型…", flush=True)
    model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(config), model=str(weights)).to("cpu").eval()
    pipeline = KPipeline(lang_code="z", repo_id="hexgrad/Kokoro-82M", model=model, device="cpu")
    timings = []
    cursor = 0.0
    segments = story["segments"][: args.limit or None]
    for index, segment in enumerate(segments):
        basename = f"{index + 1:02d}-{segment['id']}"
        target = output / f"{basename}.wav"
        chunks = []
        for result in pipeline(segment["text"], voice=str(voice), speed=args.speed, split_pattern=r"(?<=[。！？；])"):
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
        timings.append({**segment, "index": index, "file": str(target.relative_to(root)),
                        "provider": "kokoro-local", "start": cursor,
                        "end": cursor + seconds, "duration": seconds})
        cursor += seconds
        print(f"  ✓ {basename}: {seconds:.2f}s", flush=True)

    payload = {"storyId": story["id"], "voice": "zf_xiaoxiao", "provider": "kokoro-local",
               "speed": args.speed, "totalDuration": cursor, "segments": timings}
    (output / "timings.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 离线旁白完成：{len(timings)} 段，共 {cursor:.2f}s", flush=True)


if __name__ == "__main__":
    main()
