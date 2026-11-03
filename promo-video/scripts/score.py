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


# ---- 1. Flood: rising unease, every line lands with a low thump ----------
FL, MK, LG = AT['flood'], AT['mark'], AT['logo']
t = t_(sec(MK))
drone = (np.sin(2 * np.pi * 55 * t) + 0.4 * np.sin(2 * np.pi * 58.3 * t)) * np.minimum(1, t / 2) * 0.12
put(dry, 0, flt(drone, 'lowpass', 300))
noise = flt(rng.standard_normal(len(t)), 'bandpass', [400, 3000]) * (t / sec(MK)) ** 2 * 0.12
put(wet, 0, noise)
rate = 2.0
x = 0.0
while x < sec(MK) - 0.3:
    tick(x, 0.08 + 0.12 * x / sec(MK), f=2800 + rng.uniform(-300, 600))
    rate = 2 + 14 * (x / sec(MK)) ** 2
    x += 1 / rate
for i, at in enumerate(cue('flood', 'lines')):
    thump(at, 0.45 + i * 0.08)
    piano(at + 0.02, [57, 55, 53, 52][i], 0.1)
scatter(sec(FL + 210), 1.0, 0.35)

# ---- 2. Mark: everything stops; one line gets highlighted ------------------
piano(sec(MK), 69, 0.16, 4.0)
piano(sec(MK) + 0.01, 57, 0.08, 4.0)
for at in cue('mark', 'swish'):
    swish(at, 0.7, 0.6)
piano(sec(MK + 52), 76, 0.12, 3.0)
riser(sec(LG), 1.3, 0.3)

# ---- 3. Logo: a note for every piece that lands -----------------------------
thump(sec(LG), 0.6)
pad(sec(LG), [48, 55, 60, 64, 67, 71], sec(AT['highlight'] - LG) + 0.4, 0.07, 0.3)
for i, at in enumerate(cue('logo', 'build')):
    piano(at + sec(6), [60, 64, 67, 71][i], 0.15, 3.0)
piano(sec(LG + 44), 76, 0.12, 3.0)
for at in cue('logo', 'swish'):
    swish(at, 0.55)

# ---- 4-9. The groove under the chapters: 120 bpm, a beat is 15 frames -------
BEAT = 0.5
start, stop = sec(AT['highlight']), sec(AT['extras'])
prog = [  # (bass root, e-piano voicing)
    (41, [57, 60, 64, 67]),  # Fmaj9-ish
    (43, [59, 62, 65, 69]),  # G6/9
    (40, [55, 59, 62, 67]),  # Em7
    (45, [60, 64, 67, 71]),  # Am(add9)
]
kicks = []
beats = int(round((stop - start) / BEAT))
for b in range(beats):
    at = start + b * BEAT
    bar = b // 4
    root, voicing = prog[bar % 4]
    if b % 4 in (0, 2) or (b % 8 == 7):
        kick(at, 0.5)
        kicks.append(at)
    if b % 4 in (1, 3):
        snap(at)
    for s16 in range(4):
        shaker(at + s16 * BEAT / 4, 0.04 if s16 % 2 else 0.06)
    if b % 4 == 0:
        sub(at, root, BEAT * 3.6)
        for k, m in enumerate(voicing):
            epiano(at + k * 0.012, m, 0.06)
    if b % 4 == 2:
        epiano(at + BEAT / 2, voicing[-1] + 12, 0.045)
    if b % 8 == 0:
        pad(at, voicing, 8 * BEAT, 0.035, 0.4)

for scene in ('highlight', 'chats', 'collect', 'capture', 'read', 'review'):
    at = sec(AT[scene])
    riser(at, 0.5, 0.12)
    for s in cue(scene, 'swish'):
        swish(s, 0.45)
    for c in cue(scene, 'click'):
        click(c, 0.4)
for at in cue('review', 'flip'):
    swish(at - 0.1, 0.3, 0.3)
riser(stop, 1.0, 0.25)

# Duck the music under each kick so it breathes.
duck = np.ones(N)
for k in kicks:
    i, n = int(k * SR), int(0.25 * SR)
    j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], 1 - 0.45 * np.exp(-np.arange(j - i) / SR / 0.08))
music *= duck[:, None]

# ---- 10. Quick hits ---------------------------------------------------------
hits = [(53, [65, 69, 72, 76]), (55, [67, 71, 74, 79]), (57, [69, 72, 76, 79]), (48, [64, 67, 72, 76])]
for (root, ch), at in zip(hits, cue('extras', 'hits')):
    thump(at, 0.45)
    sub(at, root - 12, 0.9, 0.18)
    for k, m in enumerate(ch):
        piano(at + k * 0.03, m, 0.09, 1.6)
riser(sec(AT['end']), 0.9, 0.22)

# ---- 11. End: a warm resolve --------------------------------------------------
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
