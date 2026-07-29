#!/usr/bin/env python3
"""使用本地 Faster-Whisper 验证成片的语言与可转写性。"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from faster_whisper import WhisperModel


def model_label(model_path: str) -> str:
    for part in Path(model_path).parts:
        if part.startswith("models--"):
            return "/".join(part.removeprefix("models--").split("--"))
    return Path(model_path).name


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-language", default="zh")
    parser.add_argument("--minimum-probability", type=float, default=0.9)
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8", local_files_only=True)
    generated, info = model.transcribe(args.input, beam_size=5, vad_filter=True)
    segments = [{"start": round(item.start, 3), "end": round(item.end, 3), "text": item.text.strip()}
                for item in generated]
    passed = info.language == args.expected_language and info.language_probability >= args.minimum_probability and bool(segments)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "input": str(Path(args.input).resolve()),
        "model": model_label(args.model),
        "expectedLanguage": args.expected_language,
        "minimumProbability": args.minimum_probability,
        "language": info.language,
        "languageProbability": round(info.language_probability, 6),
        "status": "passed" if passed else "failed",
        "segments": segments,
    }
    output = Path(args.output)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown = [
        "# 本地 Whisper 反向验收报告", "",
        f"- 结论：**{payload['status'].upper()}**",
        f"- 语言：{info.language}",
        f"- 语言概率：{info.language_probability:.6f}",
        f"- 模型：{payload['model']}", "", "## 分段转写", "",
        *[f"- {item['start']:.2f}–{item['end']:.2f}s：{item['text']}" for item in segments], "",
        "> 该门禁只验证成片包含可识别的目标语言人声；本地 Whisper 模型的同音错字不代表 TTS 实际读错。", "",
    ]
    output.with_suffix(".md").write_text("\n".join(markdown), encoding="utf-8")
    print(f"✓ Whisper 验收：{payload['status']}，语言 {info.language}，概率 {info.language_probability:.6f}")
    print(f"报告：{output.with_suffix('.md')}")
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
