"""Generate all audio + data.js for the app.

Run with the edge-tts venv python:
    ~/.local/pipx/venvs/edge-tts/bin/python build.py

- texts.json      -> shadowing texts (American reference voice + word timings)
- curriculum.json -> 9 learning units: lesson words, listening-quiz clips in many voices, sentences

Audio files are named by an MD5 fingerprint of (voice + text), so re-running only
generates new or edited clips. The free Edge TTS service fails at random, so every
clip is retried; if some still fail, just run the script again.
"""
import asyncio
import hashlib
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).parent
AUDIO = ROOT / "audio"
REF = "en-US-AndrewNeural"                       # reference voice used for scoring
US = ["en-US-AndrewNeural", "en-US-AvaNeural", "en-US-GuyNeural",
      "en-US-JennyNeural", "en-US-BrianNeural", "en-US-EmmaNeural"]   # many talkers = better ear training
VS = {"gb": ["en-GB-RyanNeural", "en-GB-SoniaNeural"],
      "in": ["en-IN-PrabhatNeural", "en-IN-NeerjaNeural"]}
FAILED = []


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


async def clip(text: str, voice: str, sem: asyncio.Semaphore) -> tuple[str, list]:
    """Return (audio path, word boundaries) for text in voice, generating if needed."""
    key = hashlib.md5(f"{voice}|{text}".encode()).hexdigest()[:12]
    mp3, tfile = AUDIO / f"{key}.mp3", AUDIO / f"{key}.json"
    if mp3.exists() and mp3.stat().st_size > 0 and tfile.exists():
        return f"audio/{key}.mp3", json.loads(tfile.read_text())
    async with sem:
        for attempt in range(8):
            try:
                comm = edge_tts.Communicate(text, voice, boundary="WordBoundary")
                audio, bounds = bytearray(), []
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        audio.extend(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        s = chunk["offset"] / 1e7
                        bounds.append({"t": chunk["text"], "s": s, "e": s + chunk["duration"] / 1e7})
                if not audio:
                    raise edge_tts.exceptions.NoAudioReceived("empty")
                mp3.write_bytes(audio)
                tfile.write_text(json.dumps(bounds))
                return f"audio/{key}.mp3", bounds
            except Exception:
                await asyncio.sleep(1.5 * (attempt + 1))
    FAILED.append(f"{voice}: {text}")
    return None, []


def map_timings(text: str, bounds: list) -> list:
    timings, j = [], 0
    for w in text.split():
        nw, hit = norm(w), None
        for k in range(j, min(j + 3, len(bounds))):
            if norm(bounds[k]["t"]) == nw:
                hit, j = bounds[k], k + 1
                break
        timings.append([round(hit["s"], 3), round(hit["e"], 3)] if hit else None)
    return timings


def check(item_id: str, text: str, syl: list):
    if len(text.split()) != len(syl):
        raise SystemExit(f"{item_id}: {len(text.split())} words but {len(syl)} syllable groups")


async def practice_item(item: dict, sem) -> dict:
    """An item you can record against: American reference audio + per-word timings."""
    path, bounds = await clip(item["text"], REF, sem)
    return {**item, "words": item["text"].split(), "audio": path, "timings": map_timings(item["text"], bounds)}


async def many(text: str, voices: list, sem) -> list:
    paths = await asyncio.gather(*(clip(text, v, sem) for v in voices))
    return [{"voice": v, "src": p} for v, (p, _) in zip(voices, paths) if p]


async def build_unit(u: dict, sem) -> dict:
    words = []
    for i, w in enumerate(u["words"]):
        check(f"{u['id']} word {i}", w["text"], w["syl"])
        item = {"id": f"{u['id']}-w{i}", "level": "unit", "unit": u["id"], "text": w["text"], "syl": w["syl"]}
        words.append(item)
    sentences = []
    for i, s in enumerate(u["sentences"]):
        check(f"{u['id']} sentence {i}", s["text"], s["syl"])
        sentences.append({"id": f"{u['id']}-s{i}", "level": "sentence", "unit": u["id"], "text": s["text"], "syl": s["syl"]})
    words = await asyncio.gather(*(practice_item(w, sem) for w in words))
    sentences = await asyncio.gather(*(practice_item(s, sem) for s in sentences))
    out = {k: u[k] for k in ("id", "title", "emoji", "why", "how", "quiz")}
    out["vs"] = u.get("vs")
    out["words"], out["sentences"] = list(words), list(sentences)
    if u["quiz"] in ("accent", "stress"):
        voices_vs = VS.get(u.get("vs"), [])
        for w in out["words"]:
            w["us"] = await many(w["text"], US, sem)
            if voices_vs:
                w["other"] = await many(w["text"], voices_vs, sem)
    if u["quiz"] == "pair":
        out["pairs"] = []
        for a, b in u["pairs"]:
            out["pairs"].append([{"text": a, "us": await many(a, US, sem)}, {"text": b, "us": await many(b, US, sem)}])
    print("unit ready:", u["id"], u["title"])
    return out


async def main():
    AUDIO.mkdir(exist_ok=True)
    sem = asyncio.Semaphore(4)
    texts = json.loads((ROOT / "texts.json").read_text())
    for it in texts:
        check(it["id"], it["text"], it["syl"])
    bank = await asyncio.gather(*(practice_item(it, sem) for it in texts))
    units = await asyncio.gather(*(build_unit(u, sem) for u in json.loads((ROOT / "curriculum.json").read_text())))
    bank = list(bank) + [s for u in units for s in u["sentences"]]
    (ROOT / "data.js").write_text("window.BANK = " + json.dumps(bank) + ";\nwindow.CURRICULUM = " + json.dumps(units) + ";\n")
    n = len(list(AUDIO.glob("*.mp3")))
    print(f"data.js written: {len(bank)} shadowing texts, {len(units)} units, {n} audio clips")
    if FAILED:
        print(f"{len(FAILED)} clips failed (run again to retry):", *FAILED[:10], sep="\n  ")
        raise SystemExit(1)


asyncio.run(main())
