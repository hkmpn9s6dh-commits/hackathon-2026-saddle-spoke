#!/usr/bin/env python
"""Narration for the demo film, with fallbacks that actually work on this machine.

Three things went wrong the first time this was attempted, and each one is handled here:

1. **edge-tts is a WebSocket service.** Under a flaky proxy it connects, then times out
   mid-stream. One line succeeded and the next nine failed, which looks like "TTS is
   broken" but is just no retry.
2. **`Add-Type` is blocked by this machine's security policy**, so `System.Speech` via
   PowerShell is unavailable. `SAPI.SpVoice` through COM (pywin32) is not blocked and
   needs no compilation — that is the offline fallback.
3. **A failed synthesis still writes a zero-length file**, which then silently becomes a
   gap in the film. Every clip is therefore validated for duration and loudness.

Usage:
    python scripts/narrate.py            # synthesise anything missing, validate all
    python scripts/narrate.py --force    # redo everything
    python scripts/narrate.py --check    # validate only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'video', 'narration')
LINES = os.path.join(ROOT, 'video', 'lines.json')
MANIFEST = os.path.join(ROOT, 'video', 'narration.json')

FFMPEG = (
    os.environ.get('FFMPEG')
    or os.path.expanduser('~/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
)

# Best voice first. The list is deliberately ordered by quality, not by vendor.
EDGE_VOICES = ['en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-US-AriaNeural']
SAPI_VOICE = 'Zira'


def duration(path: str) -> float:
    out = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True, errors='ignore').stderr
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', out)
    if not m:
        return 0.0
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def mean_volume(path: str) -> float:
    """Integrated mean volume in dBFS; -inf when the clip is silent."""
    out = subprocess.run(
        [FFMPEG, '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
        capture_output=True, text=True, errors='ignore',
    ).stderr
    m = re.search(r'mean_volume: (-?[\d.]+|-inf) dB', out)
    if not m:
        return -99.0
    return -99.0 if m.group(1) == '-inf' else float(m.group(1))


def valid(path: str) -> tuple[bool, str]:
    if not os.path.exists(path) or os.path.getsize(path) < 2048:
        return False, 'empty'
    d = duration(path)
    if d < 0.4:
        return False, f'too short ({d:.2f}s)'
    v = mean_volume(path)
    if v < -45:
        return False, f'silent ({v:.0f} dB)'
    return True, f'{d:.2f}s, {v:.0f} dB'


def try_edge(text: str, voice: str, path: str, attempts: int = 3) -> bool:
    import asyncio
    import edge_tts

    async def once() -> None:
        communicate = edge_tts.Communicate(text, voice, rate='-4%')
        await communicate.save(path)

    for i in range(attempts):
        try:
            asyncio.run(once())
            ok, why = valid(path)
            if ok:
                return True
            print(f'    edge/{voice}: attempt {i + 1} produced {why}')
        except Exception as err:  # network, websocket, cancellation
            print(f'    edge/{voice}: attempt {i + 1} failed — {type(err).__name__}: {str(err)[:90]}')
        time.sleep(1.5 * (i + 1))
    return False


def try_sapi(text: str, path: str, attempts: int = 2) -> bool:
    try:
        import win32com.client as com
    except Exception as err:
        print(f'    sapi: pywin32 unavailable — {err}')
        return False
    for i in range(attempts):
        try:
            if os.path.exists(path):
                os.remove(path)
            speaker = com.Dispatch('SAPI.SpVoice')
            voices = speaker.GetVoices()
            for index in range(voices.Count):
                if SAPI_VOICE.lower() in voices.Item(index).GetDescription().lower():
                    speaker.Voice = voices.Item(index)
                    break
            stream = com.Dispatch('SAPI.SpFileStream')
            stream.Open(os.path.abspath(path), 3, False)  # SSFMCreateForWrite
            speaker.AudioOutputStream = stream
            speaker.Rate = 0
            speaker.Speak(text)
            stream.Close()
            ok, why = valid(path)
            if ok:
                return True
            print(f'    sapi: attempt {i + 1} produced {why}')
        except Exception as err:
            print(f'    sapi: attempt {i + 1} failed — {err}')
        time.sleep(1.0)
    return False


def synthesise(line: dict, force: bool) -> dict | None:
    base = os.path.join(OUT_DIR, line['id'])
    mp3, wav = base + '.mp3', base + '.wav'
    if not force:
        for path, engine in ((mp3, 'edge'), (wav, 'sapi')):
            if os.path.exists(path):
                ok, why = valid(path)
                if ok:
                    return {'id': line['id'], 'text': line['text'], 'file': os.path.relpath(path, ROOT),
                            'engine': engine, 'seconds': round(duration(path), 2), 'note': why}

    print(f'  {line["id"]}')
    for voice in EDGE_VOICES:
        if try_edge(line['text'], voice, mp3, attempts=2):
            return {'id': line['id'], 'text': line['text'], 'file': os.path.relpath(mp3, ROOT),
                    'engine': f'edge:{voice}', 'seconds': round(duration(mp3), 2), 'note': valid(mp3)[1]}
    print('    falling back to the local Windows voice')
    if try_sapi(line['text'], wav):
        return {'id': line['id'], 'text': line['text'], 'file': os.path.relpath(wav, ROOT),
                'engine': 'sapi:' + SAPI_VOICE, 'seconds': round(duration(wav), 2), 'note': valid(wav)[1]}
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()

    if not os.path.exists(FFMPEG):
        print(f'ffmpeg not found at {FFMPEG}; set FFMPEG to a build with libmp3lame and aac')
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    lines = json.load(open(LINES, encoding='utf-8'))
    print(f'{len(lines)} lines → {os.path.relpath(OUT_DIR, ROOT)}')

    manifest, failed = [], []
    for line in lines:
        if args.check:
            found = None
            for path, engine in ((os.path.join(OUT_DIR, line['id'] + '.mp3'), 'edge'),
                                 (os.path.join(OUT_DIR, line['id'] + '.wav'), 'sapi')):
                if os.path.exists(path):
                    ok, why = valid(path)
                    if ok:
                        found = {'id': line['id'], 'text': line['text'], 'file': os.path.relpath(path, ROOT),
                                 'engine': engine, 'seconds': round(duration(path), 2), 'note': why}
                        break
            entry = found
        else:
            entry = synthesise(line, args.force)
        if entry is None:
            failed.append(line['id'])
        else:
            manifest.append(entry)
            print(f'  ✓ {entry["id"]:<8} {entry["engine"]:<22} {entry["seconds"]:>5.2f}s  {entry["note"]}')

    if failed:
        print(f'\n{len(failed)} line(s) could not be synthesised: {", ".join(failed)}')
        return 1

    total = sum(e['seconds'] for e in manifest)
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'\n{len(manifest)} clips, {total:.1f}s of speech → {os.path.relpath(MANIFEST, ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
