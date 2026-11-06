"""Original score for the ThirdNote promo, cut to src/timeline.json.
Usage: python3 scripts/score.py public/score.wav

Everything is synthesised here, so there is no music licence to worry about.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
TL = json.loads((Path(__file__).resolve().parent.parent / 'src' / 'timeline.json').read_text())
FPS = TL['fps']
AT, _f = {}, 0
for name, n in TL['scenes']:
    AT[name] = _f
    _f += n
TOTAL = _f
CUES = TL['cues']
sec = lambda fr: fr / FPS
cue = lambda scene, kind: [sec(AT[scene] + c) for c in CUES.get(scene, {}).get(kind, [])]

N = int(sec(TOTAL) * SR) + SR
dry = np.zeros((N, 2))
wet = np.zeros((N, 2))
music = np.zeros((N, 2))  # ducked under the kick
rng = np.random.default_rng(11)


def t_(d):
    return np.arange(int(d * SR)) / SR


def put(bus, at, sig, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        sig = np.stack([sig * (1 - max(pan, 0)), sig * (1 + min(pan, 0))], axis=1)
    j = min(N, i + len(sig))
    bus[i:j] += sig[: j - i] * gain


def flt(x, kind, f, order=2):
    return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


# ---- sounds --------------------------------------------------------------
def swish(at, gain=0.5, dur=0.42):
    """A highlighter dragged across paper: band-passed noise that rises in pitch."""
    t = t_(dur)
    x = rng.standard_normal(len(t))
    out = np.zeros_like(x)
    for c in range(24):
        a, b = c * len(x) // 24, (c + 1) * len(x) // 24
        fc = 900 * (5 ** (c / 24))
        out[a:b] = flt(x, 'bandpass', [fc * 0.6, min(fc * 1.6, SR / 2 - 200)])[a:b]
    grain = 1 + 0.35 * np.sin(2 * np.pi * 38 * t)  # felt-tip texture
    shape = np.sin(np.pi * np.minimum(1, t / dur)) ** 1.5
    put(dry, at, out * shape * grain, gain, pan=-0.2)
    put(wet, at, out * shape, gain * 0.4, pan=0.2)


def click(at, gain=0.35):
    t = t_(0.04)
    s = flt(rng.standard_normal(len(t)), 'highpass', 2500) * np.exp(-t / 0.003)
    s += np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.008) * 0.5
    put(dry, at, s, gain)


def thump(at, gain=0.6):
    t = t_(1.2)
    f = 38 + 70 * np.exp(-t * 18)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.35)
    put(dry, at, np.tanh(1.8 * s), gain)
    put(wet, at, s * 0.3, gain)


def tick(at, gain=0.2, f=3200):
    t = t_(0.03)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006)
    put(dry, at, s, gain, pan=rng.uniform(-0.6, 0.6))


def riser(end, dur, gain=0.3):
    t = t_(dur)
    x = rng.standard_normal(len(t))
    out = np.zeros_like(x)
    for c in range(32):
        a, b = c * len(x) // 32, (c + 1) * len(x) // 32
        fc = 250 * (30 ** (c / 32))
        out[a:b] = flt(x, 'bandpass', [fc * 0.7, min(fc * 1.4, SR / 2 - 200)])[a:b]
    out *= (t / dur) ** 2.2
    put(dry, end - dur, out, gain)
    put(wet, end - dur, out, gain * 0.5)


def scatter(at, dur=1.2, gain=0.3):
    """The word 'forget' breaking apart: tiny grains flying off."""
    for k in range(60):
        u = k / 60
        tt = t_(0.03)
        g = np.sin(2 * np.pi * hz(84 - u * 30 + rng.uniform(-3, 3)) * tt) * np.hanning(len(tt))
        put(wet, at + u * dur + rng.uniform(0, 0.05), g, gain * (1 - u) * 0.6, pan=rng.uniform(-1, 1))


def piano(at, m, gain=0.18, dur=2.6, bus=None):
    t = t_(dur)
    f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * h * t) * np.exp(-t * (1.2 + h * 0.9)) for h, a in [(1, 1), (2, 0.42), (3, 0.18), (4, 0.08)])
    s *= np.minimum(1, t / 0.004)
    put(bus if bus is not None else dry, at, s, gain, pan=(m - 66) / 40)
    put(wet, at, s, gain * 0.55)


def epiano(at, m, gain=0.07, dur=1.8):
    """Soft electric piano: FM bell that decays into a sine, with tremolo."""
    t = t_(dur)
    f = hz(m)
    idx = 1.8 * np.exp(-t * 6)
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 1.6)
    s *= 1 + 0.12 * np.sin(2 * np.pi * 5.2 * t)
    put(music, at, s, gain, pan=rng.uniform(-0.35, 0.35))
    put(wet, at, s, gain * 0.5)


def pad(at, ms, dur, gain=0.06, attack=0.8):
    t = t_(dur)
    s = np.zeros((len(t), 2))
    for m in ms:
        for k, det in enumerate((-0.07, 0.06)):
            f = hz(m + det)
            tri = 2 * np.abs(2 * ((f * t + rng.random()) % 1) - 1) - 1
            s[:, k] += tri
    for ch in range(2):
        s[:, ch] = flt(s[:, ch], 'lowpass', 1800)
    s *= (np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.6))[:, None] / len(ms)
    put(music, at, s, gain)
    put(wet, at, s, gain * 0.7)


def kick(at, gain=0.55):
    t = t_(0.35)
    f = 48 + 90 * np.exp(-t * 30)
    put(dry, at, np.tanh(2.2 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)), gain)


def snap(at, gain=0.22):
    t = t_(0.18)
    n = flt(rng.standard_normal(len(t)), 'bandpass', [1500, 6000]) * np.exp(-t / 0.045)
    put(dry, at, n, gain, pan=0.1)
    put(wet, at, n, gain * 0.6)


def shaker(at, gain=0.05):
    t = t_(0.07)
    put(dry, at, flt(rng.standard_normal(len(t)), 'highpass', 6500) * np.exp(-t / 0.02), gain, pan=0.4)


def sub(at, m, dur, gain=0.22):
    t = t_(dur)
    s = np.sin(2 * np.pi * hz(m) * t) * np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.05)
    put(dry, at, s, gain)


# ---- 1. Roll: a fast, nervous pulse that keeps speeding up -----------------
RO, LO, SN = AT['roll'], AT['lost'], AT['snap']
t = t_(sec(LO))
drone = (np.sin(2 * np.pi * 55 * t) + 0.4 * np.sin(2 * np.pi * 58.3 * t)) * np.minimum(1, t / 1.5) * 0.12
put(dry, 0, flt(drone, 'lowpass', 300))
x = 0.0
while x < sec(RO + 112):
    tick(x, 0.07 + 0.1 * x / sec(RO + 112), f=2600 + rng.uniform(-300, 700))
    x += 1 / (3 + 13 * (x / sec(RO + 112)) ** 1.6)
for b in range(int(sec(RO + 112) / 0.5)):
    kick(b * 0.5, 0.32 + 0.1 * b / 7)
for i, at in enumerate(cue('roll', 'pops')):
    thump(at, 0.45)
    piano(at, [64, 67, 71, 74][i], 0.14, 1.6)
for at in cue('roll', 'keys'):
    click(at, 0.2)
for at in cue('roll', 'fail'):
    thump(at, 0.7)
    for k, m in enumerate([47, 50, 53]):
        piano(at + k * 0.01, m, 0.12, 1.4)

# ---- 2. Lost: hush, typing, then a whoosh and the word "Gone." --------------
for at in cue('lost', 'type'):
    click(at, 0.16)
piano(sec(LO), 69, 0.08, 3.0)
for at in cue('lost', 'whoosh'):
    swish(at, 0.7, 0.9)
    scatter(at + 0.2, 1.0, 0.3)
for at in cue('lost', 'gone'):
    piano(at, 57, 0.14, 3.0)
    piano(at + 0.01, 64, 0.1, 3.0)
riser(sec(SN), 1.2, 0.32)

# ---- 3. Snap: everything clicks into place, then the logo -------------------
thump(sec(SN), 0.7)
for at in cue('snap', 'snap'):
    for k in range(18):
        tick(at + 0.3 + k * 0.035, 0.18, f=1800 + k * 120)
for at in cue('snap', 'land'):
    thump(at, 0.5)
pad(sec(SN), [48, 55, 60, 64, 67, 71], sec(AT['capture'] - SN) + 0.4, 0.07, 0.3)
for i, at in enumerate(cue('snap', 'build')):
    piano(at, [60, 64, 67, 71][i], 0.15, 3.0)
for at in cue('snap', 'swish'):
    swish(at, 0.55)
    piano(at, 76, 0.12, 3.0)

# ---- 4-8. The groove under the chapters: 124 bpm ----------------------------
BEAT = 60 / 124
start, stop = sec(AT['capture']), sec(AT['hits'])
prog = [(41, [57, 60, 64, 67]), (43, [59, 62, 65, 69]), (40, [55, 59, 62, 67]), (45, [60, 64, 67, 71])]
kicks = []
beats = int(round((stop - start) / BEAT))
for b in range(beats):
    at = start + b * BEAT
    root, voicing = prog[(b // 4) % 4]
    if b % 4 in (0, 2) or (b % 8 == 7):
        kick(at, 0.52)
        kicks.append(at)
    if b % 4 in (1, 3):
        snap(at, 0.24)
    for s16 in range(4):
        shaker(at + s16 * BEAT / 4, 0.045 if s16 % 2 else 0.065)
    if b % 4 == 0:
        sub(at, root, BEAT * 3.6)
        for k, m in enumerate(voicing):
            epiano(at + k * 0.012, m, 0.06)
    if b % 2 == 1:
        epiano(at + BEAT / 2, voicing[(b // 2) % 4] + 12, 0.04)
    if b % 8 == 0:
        pad(at, voicing, 8 * BEAT, 0.035, 0.4)

for scene in ('capture', 'highlight', 'board', 'write', 'review'):
    at = sec(AT[scene])
    riser(at, 0.45, 0.14)
    swish(at - 0.15, 0.4, 0.35)  # the marker wipe
    for s_ in cue(scene, 'swish'):
        swish(s_, 0.4)
    for c in cue(scene, 'click'):
        click(c, 0.4)
for at in cue('board', 'land'):
    thump(at, 0.3)
    tick(at, 0.18, 2200)
for at in cue('board', 'pop') + cue('write', 'pop'):
    piano(at, 79, 0.1, 1.2)
for at in cue('board', 'draw'):
    swish(at, 0.25, 0.4)
for at in cue('review', 'flip'):
    swish(at - 0.1, 0.3, 0.3)
riser(stop, 0.9, 0.25)

duck = np.ones(N)
for k in kicks:
    i, n = int(k * SR), int(0.25 * SR)
    j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], 1 - 0.45 * np.exp(-np.arange(j - i) / SR / 0.08))
music *= duck[:, None]

# ---- 9. Quick hits ------------------------------------------------------------
hits = [(53, [65, 69, 72, 76]), (55, [67, 71, 74, 79]), (57, [69, 72, 76, 79]), (48, [64, 67, 72, 76])]
for (root, ch), at in zip(hits, cue('hits', 'hits')):
    thump(at, 0.5)
    sub(at, root - 12, 0.9, 0.18)
    for k, m in enumerate(ch):
        piano(at + k * 0.03, m, 0.09, 1.6)
riser(sec(AT['end']), 0.9, 0.22)

# ---- 10. End: a warm resolve ---------------------------------------------------
E = AT['end']
thump(sec(E), 0.5)
pad(sec(E), [36, 48, 55, 60, 64, 67, 71], sec(TOTAL - E) + 0.3, 0.08, 0.4)
for i, m in enumerate([72, 76, 79, 83, 84]):
    piano(sec(E) + 0.2 + i * 0.22, m, 0.1, 3.0)
for at in cue('end', 'swish'):
    swish(at, 0.5)

# ---- mix --------------------------------------------------------------------
ir_t = t_(2.8)
ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t / 0.8)[:, None]
ir = np.stack([flt(ir[:, c], 'lowpass', 6000) for c in range(2)], axis=1)
rev = np.stack([fftconvolve(wet[:, c], ir[:, c])[:N] for c in range(2)], axis=1)
rev /= np.max(np.abs(rev)) + 1e-9
mix = dry + music + rev * 0.25 * max(np.max(np.abs(wet)), 1e-6) * 2.5

end = int(sec(TOTAL) * SR)
mix = mix[:end]
fade = int(1.2 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix = np.tanh(mix * 1.3)
mix /= np.max(np.abs(mix)) / 0.89
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{len(mix) / SR:.2f}s')
