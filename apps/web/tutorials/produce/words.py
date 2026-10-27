# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["faster-whisper==1.2.1", "numpy"]
# ///
"""
Every spoken word of a narration take, with when it starts and ends, as JSON on stdout:

    uv run tutorials/produce/words.py <take.wav>   ->   [{"w": "Ready.", "start": 0.42, "end": 0.71}, …]

`bracketTrim.ts` cuts the "Ready." / "Okay." brackets off a Higgsfield take by finding those two
WORDS, and checks the words between them against the script. It is Python because the speech-to-text
that gives word timings on a Mac without a GPU is faster-whisper; `uv run` reads the dependencies
above and builds a throwaway environment for them, so the repository carries no Python setup.

Audio is decoded by ffmpeg rather than faster-whisper's own `av` decoder: on 2026-10-27 the `av`
that resolved alongside faster-whisper 1.2.1 rejected its `metadata_errors` argument and nothing ran.
"""
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

pcm = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", sys.argv[1], "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
    capture_output=True, check=True,
).stdout
# small.en: base.en heard "McLeod" as "a cloud" and lost short words; small.en is ~2 s a line on CPU.
model = WhisperModel("small.en", device="cpu", compute_type="int8")
segments, _ = model.transcribe(np.frombuffer(pcm, np.float32), beam_size=5, word_timestamps=True)
print(json.dumps([{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                  for s in segments for w in (s.words or [])]))
