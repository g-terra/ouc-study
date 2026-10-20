#!/usr/bin/env python3
"""Speech to text on this computer with faster-whisper (free; the model downloads once, then it works offline).
Used by `ouc transcribe` where whisper.cpp isn't installed (packages/ai/src/transcribe.ts).

Usage: python3 tools/transcribe.py [--model small] FILE...
Prints one JSON line per spoken segment: {"file": <index of FILE>, "start": s, "end": s, "text": "..."}.
--check: exit 0 if faster-whisper is installed (pip install faster-whisper)."""
import json
import sys


def main(argv):
    if "--check" in argv:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return 1
        return 0
    model = "small"
    if "--model" in argv:
        i = argv.index("--model")
        model = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    from faster_whisper import WhisperModel

    m = WhisperModel(model, device="auto", compute_type="int8")
    for n, path in enumerate(argv):
        try:
            segments, _info = m.transcribe(path, vad_filter=True)
            for s in segments:
                print(json.dumps({"file": n, "start": s.start, "end": s.end, "text": s.text.strip()}), flush=True)
        except Exception as e:  # one bad clip shouldn't lose the rest
            print(json.dumps({"file": n, "error": str(e)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
