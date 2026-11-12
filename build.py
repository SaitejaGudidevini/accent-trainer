"""Generate American reference audio + word timings for every text in texts.json.

Run with the edge-tts venv python:
    ~/.local/pipx/venvs/edge-tts/bin/python build.py

Audio files are named by an MD5 fingerprint of (voice + text), so only new or
edited texts are re-generated. Output: audio/*.mp3 and data.js (loaded by index.html).
"""
import asyncio
import hashlib
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).parent
VOICE = "en-US-AndrewNeural"
AUDIO = ROOT / "audio"


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


async def synth(item: dict, sem: asyncio.Semaphore) -> dict:
    key = hashlib.md5(f"{VOICE}|{item['text']}".encode()).hexdigest()[:12]
    mp3 = AUDIO / f"{key}.mp3"
    timing_file = AUDIO / f"{key}.json"
    if mp3.exists() and timing_file.exists():
        bounds = json.loads(timing_file.read_text())
    else:
        async with sem:
            for attempt in range(6):  # the free Edge TTS service fails requests at random
                try:
                    comm = edge_tts.Communicate(item["text"], VOICE, boundary="WordBoundary")
                    audio, bounds = bytearray(), []
                    async for chunk in comm.stream():
                        if chunk["type"] == "audio":
                            audio.extend(chunk["data"])
                        elif chunk["type"] == "WordBoundary":
                            start = chunk["offset"] / 1e7
                            bounds.append({"t": chunk["text"], "s": start,
                                           "e": start + chunk["duration"] / 1e7})
                    break
                except edge_tts.exceptions.EdgeTTSException:
                    if attempt == 5:
                        raise
                    await asyncio.sleep(1.5 * (attempt + 1))
            mp3.write_bytes(audio)
            timing_file.write_text(json.dumps(bounds))
        print("generated", item["id"])

    # Map TTS word boundaries onto the words of the text (skip punctuation-only tokens).
    words = item["text"].split()
    timings, j = [], 0
    for w in words:
        nw, hit = norm(w), None
        for k in range(j, min(j + 3, len(bounds))):
            if norm(bounds[k]["t"]) == nw:
                hit, j = bounds[k], k + 1
                break
        timings.append([round(hit["s"], 3), round(hit["e"], 3)] if hit else None)
    return {**item, "words": words, "audio": f"audio/{key}.mp3", "timings": timings}


async def main():
    AUDIO.mkdir(exist_ok=True)
    items = json.loads((ROOT / "texts.json").read_text())
    for it in items:
        n_words, n_syl = len(it["text"].split()), len(it["syl"])
        if n_words != n_syl:
            raise SystemExit(f"{it['id']}: {n_words} words but {n_syl} syllable groups")
    sem = asyncio.Semaphore(2)
    out = await asyncio.gather(*(synth(it, sem) for it in items))
    (ROOT / "data.js").write_text("window.BANK = " + json.dumps(out, indent=1) + ";\n")
    missing = sum(t is None for o in out for t in o["timings"])
    print(f"data.js written: {len(out)} texts, {missing} words without timing")


asyncio.run(main())
