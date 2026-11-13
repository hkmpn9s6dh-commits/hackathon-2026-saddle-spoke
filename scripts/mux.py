#!/usr/bin/env python
"""Lay the narration over the recorded picture.

The picture and the voice are both built from `video/timeline.json`, which the recorder
writes: every beat has a start time and a line. This script places each clip at
`preRoll + start + lead`, mixes a very quiet room tone under it, normalises the result and
wraps it in H.264/AAC.

    python scripts/narrate.py && node scripts/demo.mjs && python scripts/mux.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

FFMPEG = (
    os.environ.get('FFMPEG')
    or os.path.expanduser('~/AppData/Roaming/Python/Python313/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
)
LEAD = 0.45
TARGET_LUFS = -16  # speech-led programme; -14 is streaming loud, -16 keeps the film calm
BED_GAIN = 0.05


def duration(path: str) -> float:
    out = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True, errors='ignore').stderr
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', out)
    if not m:
        raise SystemExit(f'cannot read the duration of {path}')
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def main() -> int:
    video = sys.argv[1] if len(sys.argv) > 1 else 'video/saddle-and-spoke-demo.webm'
    out = sys.argv[2] if len(sys.argv) > 2 else 'submission/saddle-and-spoke-demo.mp4'
    timeline = json.load(open('video/timeline.json', encoding='utf-8'))
    beats = timeline['beats']
    pre_roll = timeline['preRollMs'] / 1000.0
    film = duration(video)

    inputs = ['-i', video]
    filters = []
    labels = []
    for index, beat in enumerate(beats, start=1):
        clip = os.path.join(ROOT, beat['voice'])
        if not os.path.exists(clip):
            raise SystemExit(f'missing narration clip {clip}')
        inputs += ['-i', clip]
        delay = int(round((pre_roll + beat['start'] + LEAD) * 1000))
        filters.append(
            f'[{index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,'
            f'adelay={delay},volume=1.0[v{index}]'
        )
        labels.append(f'[v{index}]')

    bed_index = len(beats) + 1
    inputs += ['-f', 'lavfi', '-i', f'anoisesrc=color=brown:amplitude=0.05:duration={film + 1:.2f}:sample_rate=48000']
    filters.append(
        f'[{bed_index}:a]highpass=f=45,lowpass=f=380,volume={BED_GAIN},'
        f'afade=t=in:st=0:d=1.4,afade=t=out:st={max(0, film - 2):.2f}:d=2[bed]'
    )

    mix_inputs = ''.join(labels) + '[bed]'
    filters.append(
        f'{mix_inputs}amix=inputs={len(labels) + 1}:normalize=0:dropout_transition=0,'
        f'loudnorm=I={TARGET_LUFS}:TP=-2:LRA=11[a]'
    )

    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [
        FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *inputs,
        '-filter_complex', ';'.join(filters),
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        '-t', f'{film:.3f}', out,
    ]
    subprocess.run(cmd, check=True)
    print(f'{out}: {film:.1f}s picture, {len(beats)} lines, {os.path.getsize(out) / 1e6:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
