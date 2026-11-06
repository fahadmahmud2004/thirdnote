import React from 'react';
import {Img, interpolate, random, staticFile, useCurrentFrame} from 'remotion';
import {C, CUES, F, SCENES, expoOut, keys, ramp} from './theme';
import {Browser, Camera, Caret, Chip, Cursor, Fill, Logo, Marker, Paper, Rect, Reveal, ShotKey, Words, pop, typed} from './kit';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const exitOf = (f: number, dur: number, len = 8) => interpolate(f, [dur - len, dur], [1, 0], clamp);
const img = (name: string) => staticFile(`shots/${name}.png`);

/* ---- Gallery tiles: the kind of screenshots everyone has too many of ---- */
const SHOT_TILES = ['chat-plain', 'web-saved', 'reader', 'review-front', 'capture-card', 'reader-ideas'];
const QUOTES = ['Lead with the question.', 'Ship small, ship often.', 'Contrast beats colour.', 'Read it twice.', 'Hook in 5 seconds.'];
const PASTELS = ['#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fed7aa'];

export const Tile: React.FC<{seed: number; size: number}> = ({seed, size}) => {
  const r = (k: string) => random(`${k}-${seed}`);
  const kind = Math.floor(r('k') * 7);
  const radius = size * 0.08;
  const base: React.CSSProperties = {width: size, height: size, borderRadius: radius, overflow: 'hidden', position: 'relative', flex: 'none'};
  if (kind <= 1) {
    return (
      <div style={{...base, background: '#111'}}>
        <Img src={img(`thumb-${1 + Math.floor(r('t') * 4)}`)} style={{position: 'absolute', height: '100%', left: '50%', transform: 'translateX(-50%)'}} />
      </div>
    );
  }
  if (kind === 2) {
    const s = SHOT_TILES[Math.floor(r('s') * SHOT_TILES.length)];
    return (
      <div style={{...base, background: '#fff'}}>
        <Img src={img(s)} style={{position: 'absolute', height: '100%', left: `${-r('x') * 120}%`}} />
      </div>
    );
  }
  if (kind === 3) {
    return (
      <div style={{...base, background: PASTELS[Math.floor(r('p') * PASTELS.length)], padding: size * 0.1, boxSizing: 'border-box'}}>
        {[0.9, 0.7, 0.8, 0.5, 0.75].map((w, i) => (
          <div key={i} style={{height: size * 0.05, width: `${w * 100}%`, background: 'rgba(0,0,0,.18)', borderRadius: 99, marginBottom: size * 0.07}} />
        ))}
      </div>
    );
  }
  if (kind === 4) {
    return (
      <div style={{...base, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: size * 0.1, boxSizing: 'border-box'}}>
        <div style={{fontFamily: F.serif, color: '#fff', fontSize: size * 0.13, lineHeight: 1.1, textAlign: 'center'}}>{QUOTES[Math.floor(r('q') * QUOTES.length)]}</div>
      </div>
    );
  }
  if (kind === 5) {
    return (
      <div style={{...base, background: '#fff', display: 'flex', alignItems: 'flex-end', gap: size * 0.05, padding: size * 0.12, boxSizing: 'border-box'}}>
        {[0.4, 0.7, 0.55, 0.9, 0.65].map((h, i) => (
          <div key={i} style={{flex: 1, height: `${h * 100}%`, background: [C.blue, C.marker, C.green, C.red, C.blue][i], borderRadius: 4}} />
        ))}
      </div>
    );
  }
  return (
    <div style={{...base, background: '#f3f4f6', padding: size * 0.08, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: size * 0.06}}>
      <div style={{alignSelf: 'flex-end', width: '60%', height: size * 0.14, background: '#e5e7eb', borderRadius: size * 0.06}} />
      <div style={{width: '85%', height: size * 0.3, background: '#fff', borderRadius: size * 0.06}} />
      <div style={{alignSelf: 'flex-end', width: '45%', height: size * 0.14, background: '#e5e7eb', borderRadius: size * 0.06}} />
      <div style={{width: '75%', height: size * 0.2, background: '#fff', borderRadius: size * 0.06}} />
    </div>
  );
};

/* ---- 1. The camera roll: too many screenshots ----------------------------- */
const POP_WORDS = ['Ideas.', 'Thumbnails.', 'Answers.', 'Notes.'];
const POP_COLORS = [C.marker, '#ff8a65', '#7dd3a8', '#8fb4ff'];

export const Roll: React.FC = () => {
  const f = useCurrentFrame();
  const T = 156;
  const speed = f * 4 + f * f * 0.045;
  const count = Math.floor(interpolate(f, [0, 200], [312, 4382], {...clamp, easing: (t) => t * t}));
  const query = 'that thumbnail idea';
  const qStart = CUES.roll.keys[0];
  const fail = CUES.roll.fail[0];
  const shake = f >= fail && f < fail + 14 ? Math.sin((f - fail) * 2.4) * (1 - (f - fail) / 14) * 18 : 0;
  const blur = interpolate(f, [100, 130], [0, 6], clamp);
  return (
    <Fill bg={C.night}>
      <div style={{position: 'absolute', inset: '-40px -60px', transform: 'rotate(-6deg) scale(1.08)', filter: `blur(${blur}px)`, opacity: 0.92}}>
        {Array.from({length: 8}).map((_, col) => (
          <div
            key={col}
            style={{
              position: 'absolute',
              left: col * (T + 16),
              top: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              transform: `translateY(${-((speed * (0.85 + (col % 3) * 0.12) + col * 230) % (24 * (T + 16)))}px)`,
            }}
          >
            {Array.from({length: 36}).map((__, i) => (
              <Tile key={i} seed={col * 100 + (i % 24)} size={T} />
            ))}
          </div>
        ))}
      </div>
      <Fill bg="radial-gradient(ellipse 55% 50% at 50% 50%, rgba(11,16,34,.94) 30%, rgba(11,16,34,.55) 75%, rgba(11,16,34,.2) 100%)" />
      <div style={{position: 'absolute', top: 60, right: 80, display: 'flex', alignItems: 'center', gap: 12, fontFamily: F.sans, fontWeight: 650, fontSize: 24, color: C.fgDark, fontVariantNumeric: 'tabular-nums', opacity: ramp(f, 4, 10)}}>
        <span style={{width: 10, height: 10, borderRadius: 9, background: C.red}} />
        {count.toLocaleString('en-US')} screenshots
      </div>
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34}}>
        {f < 120 && (
          <>
            <div style={{fontFamily: F.serif, fontSize: 116, color: C.fgDark, lineHeight: 1, opacity: 1 - ramp(f, 108, 10), transform: `translateY(${-ramp(f, 50, 20) * 20}px)`}}>
              <Words f={f} start={2} gap={5} text="You screenshot everything." />
            </div>
            <div style={{display: 'flex', gap: 26, height: 90, opacity: 1 - ramp(f, 108, 10)}}>
              {POP_WORDS.map((w, i) => {
                const p = pop(f, CUES.roll.pops[i], 14);
                return (
                  <div
                    key={w}
                    style={{
                      fontFamily: F.sans,
                      fontWeight: 800,
                      fontSize: 60,
                      letterSpacing: '-0.03em',
                      color: C.ink,
                      background: POP_COLORS[i],
                      padding: '4px 22px 8px',
                      borderRadius: 16,
                      transform: `scale(${p}) rotate(${(i % 2 ? 3 : -3) * (1 - Math.min(1, p))}deg)`,
                      opacity: Math.min(1, p * 3),
                    }}
                  >
                    {w}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {f >= 112 && (
          <>
            <div style={{fontFamily: F.serif, fontSize: 92, color: C.fgDark, lineHeight: 1}}>
              <Words f={f} start={112} gap={4} text="Now find the one you need." />
            </div>
            <div
              style={{
                width: 900,
                height: 92,
                borderRadius: 999,
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: '0 34px',
                boxShadow: '0 30px 80px rgba(0,0,0,.45)',
                transform: `translateX(${shake}px) scale(${0.9 + ramp(f, 116, 16) * 0.1})`,
                opacity: ramp(f, 116, 12),
                fontFamily: F.sans,
                fontSize: 38,
                color: C.text,
              }}
            >
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7.5" />
                <path d="m20.5 20.5-4.2-4.2" />
              </svg>
              <span>
                {typed(f, query, qStart, 0.4)}
                {f < fail && <Caret f={f} />}
              </span>
              <span style={{marginLeft: 'auto', fontSize: 26, fontWeight: 700, color: C.red, opacity: ramp(f, fail, 6)}}>No results</span>
            </div>
          </>
        )}
      </div>
    </Fill>
  );
};

/* ---- 2. The 2 a.m. idea that disappears ----------------------------------- */
const TABS = ['Thumbnail ideas', 'Lecture notes', 'Research paper', 'Recipe', 'Chat about entropy', 'Saved video'];

export const Lost: React.FC = () => {
  const f = useCurrentFrame();
  const fly = ramp(f, CUES.lost.whoosh[0], 26, (t) => t * t);
  const gone = ramp(f, CUES.lost.gone[0], 16);
  const exit = exitOf(f, SCENES.lost, 8);
  return (
    <Fill bg={C.night} style={{opacity: exit}}>
      <div style={{position: 'absolute', top: 70, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 10}}>
        {TABS.map((t, i) => {
          const at = 40 + i * 6;
          const c = ramp(f, at, 14, (x) => x * x);
          return (
            <div
              key={t}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px',
                borderRadius: 12,
                background: 'rgba(255,255,255,.08)',
                color: C.mutedDark,
                fontFamily: F.sans,
                fontSize: 20,
                fontWeight: 550,
                transform: `translateY(${-c * 160}px) rotate(${(random(`tab${i}`) - 0.5) * 40 * c}deg)`,
                opacity: ramp(f, i * 2, 8) * (1 - c),
              }}
            >
              {t}
              <span style={{opacity: 0.6}}>✕</span>
            </div>
          );
        })}
      </div>
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40}}>
        <div style={{fontFamily: F.sans, fontWeight: 600, fontSize: 34, color: C.mutedDark, opacity: ramp(f, 0, 10) * (1 - gone)}}>That idea you had at 2 a.m.?</div>
        <div
          style={{
            width: 560,
            minHeight: 300,
            background: '#fff3bf',
            borderRadius: '8px 8px 34px 8px',
            padding: '34px 38px',
            boxSizing: 'border-box',
            fontFamily: F.sans,
            fontWeight: 600,
            fontSize: 40,
            lineHeight: 1.25,
            color: '#2a2721',
            boxShadow: '0 30px 80px rgba(0,0,0,.4)',
            transform: `translate(${-fly * 1300}px, ${fly * 260}px) rotate(${-8 + fly * -70}deg) scale(${pop(f, 0, 14) * (1 - fly * 0.4)})`,
            filter: `blur(${fly * 8}px)`,
            opacity: 1 - fly * 0.6,
          }}
        >
          {typed(f, 'Explain entropy with a messy room vs a tidy room', 4, 1.9)}
          {f < 52 && <Caret f={f} color="#2a2721" />}
        </div>
      </div>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
        <div style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 220, color: C.marker, opacity: gone, transform: `scale(${1.25 - gone * 0.25})`, letterSpacing: '-0.02em'}}>
          Gone.
        </div>
      </div>
    </Fill>
  );
};

/* ---- 3. Everything snaps into place, the logo builds ---------------------- */
export const Snap: React.FC = () => {
  const f = useCurrentFrame();
  const bg = ramp(f, 4, 28);
  const go = ramp(f, CUES.snap.snap[0], 30, expoOut);
  const away = ramp(f, 54, 24, (t) => t * t);
  const tag = ramp(f, CUES.snap.swish[0], 20);
  const cols = 8;
  const rows = 4;
  const size = 150;
  const gap = 22;
  const gw = cols * size + (cols - 1) * gap;
  const gh = rows * size + (rows - 1) * gap;
  return (
    <Fill bg={C.night}>
      <div style={{position: 'absolute', inset: 0, clipPath: `circle(${bg * 80}% at 50% 50%)`}}>
        <Paper drift={f * 0.4} />
      </div>
      <div style={{position: 'absolute', inset: 0, opacity: 1 - away, transform: `scale(${1 + away * 0.5})`}}>
        {Array.from({length: cols * rows}).map((_, i) => {
          const r = (k: string) => random(`snap-${k}-${i}`);
          const sx = r('x') * 2100 - 90;
          const sy = r('y') * 1240 - 80;
          const tx = 960 - gw / 2 + (i % cols) * (size + gap);
          const ty = 540 - gh / 2 + Math.floor(i / cols) * (size + gap);
          const lag = Math.min(1, Math.max(0, (go * 1.25 - r('l') * 0.25)));
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: sx + (tx - sx) * lag,
                top: sy + (ty - sy) * lag,
                transform: `rotate(${(r('r') - 0.5) * 70 * (1 - lag)}deg) scale(${1.2 - lag * 0.2})`,
                boxShadow: '0 12px 30px rgba(0,0,0,.18)',
                borderRadius: 12,
              }}
            >
              <Tile seed={i + 500} size={size} />
            </div>
          );
        })}
      </div>
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 46, opacity: ramp(f, 60, 10)}}>
        <div style={{transform: `scale(${1.08 - ramp(f, 62, 60) * 0.08})`}}>
          <Logo f={f - 64} width={430} />
        </div>
        <Reveal p={ramp(f, 110, 18)}>
          <div style={{fontFamily: F.serif, fontSize: 70, color: C.text, letterSpacing: '-0.01em'}}>
            Capture everything. <Marker p={tag}>Remember anything.</Marker>
          </div>
        </Reveal>
      </div>
    </Fill>
  );
};

/* ---- Feature chapters with a real screen ----------------------------------- */
export type FeatureProps = {
  scene: string;
  num: string;
  label: string;
  title: string;
  mark: string;
  chips: {text: string; dot?: string}[];
  url: string;
  shots: ShotKey[];
  cam?: Camera;
  cursor?: Cursor;
  rect?: Rect;
  flip?: number;
};

export const Feature: React.FC<FeatureProps> = (p) => {
  const f = useCurrentFrame();
  const dur = SCENES[p.scene];
  const swish = CUES[p.scene]?.swish?.[0] ?? 20;
  const inP = ramp(f, 0, 26);
  const exit = exitOf(f, dur, 7);
  const float = Math.sin(f / 22) * 6;
  return (
    <Paper drift={f * 0.6}>
      <div style={{position: 'absolute', inset: 0, opacity: exit}}>
        <div style={{position: 'absolute', left: 140, top: 0, bottom: 0, width: 620, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 18}}>
            <span style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 96, lineHeight: 1, color: C.ink, transform: `translateX(${(1 - ramp(f, 0, 16)) * -60}px)`, opacity: ramp(f, 0, 10)}}>{p.num}</span>
            <span style={{fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.muted, opacity: ramp(f, 6, 10)}}>{p.label}</span>
          </div>
          <div style={{marginTop: 24, fontFamily: F.serif, fontSize: 84, lineHeight: 1.04, color: C.text, letterSpacing: '-0.015em'}}>
            <Words f={f} start={4} gap={3} text={p.title} mark={p.mark} markAt={swish} />
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40}}>
            {p.chips.map((c, i) => (
              <div key={c.text} style={{transform: `scale(${pop(f, 34 + i * 6, 14)})`, transformOrigin: 'left center'}}>
                <Chip p={Math.min(1, pop(f, 34 + i * 6, 14))} dot={c.dot}>
                  {c.text}
                </Chip>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 800,
            top: 200 + float,
            transform: `perspective(2400px) translateX(${(1 - inP) * 500}px) rotateY(${-16 + inP * 10}deg) rotateZ(${(1 - inP) * 4}deg)`,
            transformOrigin: 'left center',
            opacity: Math.min(1, inP * 1.6),
          }}
        >
          <Browser f={f} width={1040} url={p.url} shots={p.shots} cam={p.cam} cursor={p.cursor} rect={p.rect} flip={p.flip} />
        </div>
      </div>
    </Paper>
  );
};

/* ---- The board: everything laid out on a canvas ------------------------------- */
type Card = {x: number; y: number; w: number; land: number; from: [number, number, number]};

const BoardCard: React.FC<{f: number; c: Card; children: React.ReactNode; bg?: string; radius?: number | string; shadow?: string}> = ({f, c, children, bg = '#fff', radius = 16, shadow}) => {
  const p = ramp(f, c.land, 22, expoOut);
  const s = pop(f, c.land, 20);
  return (
    <div
      style={{
        position: 'absolute',
        left: c.x + c.from[0] * (1 - p),
        top: c.y + c.from[1] * (1 - p),
        width: c.w,
        transform: `rotate(${c.from[2] * (1 - p)}deg) scale(${0.85 + Math.min(1.1, s) * 0.15})`,
        opacity: Math.min(1, p * 3),
        background: bg,
        borderRadius: radius,
        boxShadow: shadow ?? '0 1px 2px rgba(27,26,24,.05), 0 10px 30px rgba(27,26,24,.10)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
};

const SrcLine: React.FC<{site: string; icon?: string}> = ({site}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 13px', fontFamily: F.sans, fontSize: 14, color: C.muted}}>
    <span style={{width: 18, height: 18, borderRadius: 5, background: '#8a857c', display: 'inline-block'}} />
    {site}
    <span style={{marginLeft: 'auto', color: '#a29d93'}}>just now</span>
  </div>
);

const Arrow: React.FC<{f: number; at: number; d: string}> = ({f, at, d}) => {
  const p = ramp(f, at, 18, expoOut);
  return (
    <g>
      <path d={d} fill="none" stroke="#6b675f" strokeWidth={2.5} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} markerEnd={p > 0.95 ? 'url(#head)' : undefined} />
    </g>
  );
};

export const BoardScene: React.FC = () => {
  const f = useCurrentFrame();
  const L = CUES.board.land;
  const exit = exitOf(f, SCENES.board, 8);
  const z = keys(f, [[0, 1.12], [120, 1.02], [270, 0.94]]);
  const camX = keys(f, [[0, 40], [270, -10]]);
  const winIn = ramp(f, 0, 24);
  const thumbs: Card[] = [
    {x: 80, y: 130, w: 340, land: L[0], from: [-900, -300, -30]},
    {x: 450, y: 130, w: 340, land: L[1], from: [-200, -800, 25]},
    {x: 820, y: 130, w: 340, land: L[2], from: [600, -700, -20]},
  ];
  const shotCard: Card = {x: 80, y: 445, w: 340, land: L[3], from: [-900, 500, 22]};
  const noteCard: Card = {x: 450, y: 445, w: 340, land: L[4], from: [0, 800, -18]};
  const quoteCard: Card = {x: 820, y: 445, w: 340, land: L[5], from: [700, 600, 26]};
  const [dbl] = CUES.board.click;
  const [pop1, pop2] = CUES.board.pop;
  const [draw1, draw2] = CUES.board.draw;
  const s1 = pop(f, pop1, 16);
  const s2 = pop(f, pop2, 16);
  // cursor
  const cx = keys(f, [[92, 1500], [108, 1330], [128, 1330], [150, 1600]], expoOut);
  const cy = keys(f, [[92, 820], [108, 210], [128, 210], [150, 700]], expoOut);
  const cursorShow = ramp(f, 90, 8) * (1 - ramp(f, 146, 8));
  const clickRing = f >= dbl && f < dbl + 18 ? (f - dbl) / 18 : 0;
  const chips = ['Move & resize', 'Sticky notes', 'Arrows', 'Paste images'];
  return (
    <Paper drift={f * 0.5}>
      <div style={{position: 'absolute', inset: 0, opacity: exit}}>
        <div style={{position: 'absolute', left: 120, top: 54, display: 'flex', alignItems: 'baseline', gap: 26}}>
          <span style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 80, lineHeight: 1, color: C.ink, opacity: ramp(f, 0, 10)}}>03</span>
          <div style={{fontFamily: F.serif, fontSize: 76, lineHeight: 1.05, color: C.text, letterSpacing: '-0.015em'}}>
            <Words f={f} start={2} gap={3} text="All of it, on one board." mark="board" markAt={CUES.board.swish[0]} />
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 120,
            right: 120,
            top: 190,
            bottom: 50,
            borderRadius: 22,
            overflow: 'hidden',
            background: '#f5f4f0',
            boxShadow: '0 2px 6px rgba(20,18,15,.08), 0 40px 90px rgba(20,18,15,.25)',
            transform: `translateY(${(1 - winIn) * 200}px) scale(${0.94 + winIn * 0.06})`,
            opacity: winIn,
          }}
        >
          <div style={{height: 56, display: 'flex', alignItems: 'center', padding: '0 22px', gap: 12, fontFamily: F.sans, fontSize: 16, color: C.muted, background: 'rgba(245,244,240,.9)', position: 'relative', zIndex: 2, boxShadow: '0 1px 0 rgba(27,26,24,.07)'}}>
            <Logo f={0} width={26} word={false} built />
            <span>My channel / </span>
            <span style={{color: C.text}}>Video ideas</span>
            <div style={{margin: '0 auto', display: 'flex', gap: 4, background: '#efede7', borderRadius: 11, padding: 4}}>
              {['Read', 'Highlights', 'Board', 'Review'].map((t) => (
                <span key={t} style={{padding: '6px 16px', borderRadius: 8, background: t === 'Board' ? '#fff' : 'transparent', color: t === 'Board' ? C.text : C.muted, fontWeight: 600, boxShadow: t === 'Board' ? '0 1px 3px rgba(0,0,0,.08)' : 'none'}}>{t}</span>
              ))}
            </div>
            <span style={{width: 200}} />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: '56px 0 0 0',
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(27,26,24,.14) 1.2px, transparent 0)',
              backgroundSize: `${22 * z}px ${22 * z}px`,
              backgroundPosition: `${camX}px 0`,
            }}
          >
            <div style={{position: 'absolute', left: 0, top: 0, width: 1680, height: 800, transformOrigin: '840px 300px', transform: `translateX(${camX}px) scale(${z})`}}>
              <div style={{position: 'absolute', left: 80, top: 34, fontFamily: F.sans, fontWeight: 800, fontSize: 44, letterSpacing: '-0.025em', color: C.text}}>
                {typed(f, 'Why time only moves forward', 18, 1.3)}
              </div>
              <div style={{position: 'absolute', left: 82, top: 92, fontFamily: F.sans, fontSize: 18, color: C.muted, opacity: ramp(f, 36, 12)}}>Thumbnails, hook and research in one place.</div>
              {thumbs.map((c, i) => (
                <BoardCard key={i} f={f} c={c}>
                  <Img src={img(`thumb-${i + 1}`)} style={{width: '100%', display: 'block', boxShadow: `0 3px 0 ${[C.marker, C.red, C.green][i]}`}} />
                  <div style={{padding: '12px 16px 6px', fontFamily: F.sans, fontSize: 16, color: C.text}}>{['Version A: the clock reads well', 'Version B: loud colour, two words', 'Before / after works for this'][i]}</div>
                  <SrcLine site={['watch.example.com', 'design.example.com', 'pins.example.com'][i]} />
                </BoardCard>
              ))}
              <BoardCard f={f} c={shotCard}>
                <div style={{height: 190, overflow: 'hidden', position: 'relative'}}>
                  <Img src={img('web-saved')} style={{position: 'absolute', width: 700, left: -150, top: -40}} />
                </div>
                <div style={{padding: '12px 16px 6px', fontFamily: F.sans, fontSize: 16, color: C.text}}>Clean diagram for the thumbnail</div>
                <SrcLine site="science.example.org" />
              </BoardCard>
              <BoardCard f={f} c={noteCard} bg="#fdf8e8">
                <div style={{padding: '16px 18px 8px', fontFamily: F.sans, fontSize: 18, lineHeight: 1.45, color: C.text}}>
                  <b>Comment idea:</b> explain entropy with a messy room vs a tidy room.
                </div>
                <SrcLine site="My notes" />
              </BoardCard>
              <BoardCard f={f} c={quoteCard}>
                <div style={{display: 'flex'}}>
                  <div style={{width: 5, background: C.blue}} />
                  <div style={{flex: 1}}>
                    <div style={{padding: '16px 18px 8px', fontFamily: F.serif, fontSize: 21, lineHeight: 1.4, color: C.text}}>People remember stories, not formulas. Lead with the question.</div>
                    <SrcLine site="AI chat" />
                  </div>
                </div>
              </BoardCard>
              {/* sticky typed after a double-click */}
              <div
                style={{
                  position: 'absolute',
                  left: 1220,
                  top: 120,
                  width: 300,
                  minHeight: 250,
                  background: '#fff3bf',
                  borderRadius: '6px 6px 22px 6px',
                  padding: '22px 24px',
                  boxSizing: 'border-box',
                  boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 14px 34px rgba(0,0,0,.12)',
                  transform: `scale(${s1})`,
                  transformOrigin: '110px 90px',
                  fontFamily: F.sans,
                  color: '#2a2721',
                }}
              >
                <div style={{fontWeight: 800, fontSize: 28}}>{typed(f, 'Hook', pop1 + 4, 0.8)}</div>
                <div style={{fontSize: 21, lineHeight: 1.4, marginTop: 8, fontWeight: 500}}>
                  {typed(f, 'Ice cube melting in timelapse. Why does it never refreeze?', pop1 + 12, 1.4)}
                  {f > pop1 && f < pop2 - 4 && <Caret f={f} color="#2a2721" />}
                </div>
              </div>
              <div
                style={{
                  position: 'absolute',
                  left: 1220,
                  top: 420,
                  width: 300,
                  minHeight: 230,
                  background: '#dce8fd',
                  borderRadius: '6px 6px 22px 6px',
                  padding: '22px 24px',
                  boxSizing: 'border-box',
                  boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 14px 34px rgba(0,0,0,.12)',
                  transform: `scale(${s2})`,
                  fontFamily: F.sans,
                  color: '#1d2433',
                }}
              >
                <div style={{fontWeight: 800, fontSize: 24}}>Thumbnail rules</div>
                {['One clear shape', 'Three words max', 'High contrast'].map((t, i) => (
                  <div key={t} style={{fontSize: 20, marginTop: 10, display: 'flex', gap: 10, opacity: ramp(f, pop2 + 8 + i * 6, 8), transform: `translateX(${(1 - ramp(f, pop2 + 8 + i * 6, 10)) * 16}px)`}}>
                    <span>•</span>
                    {t}
                  </div>
                ))}
              </div>
              <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1} height={1}>
                <defs>
                  <marker id="head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="#6b675f" />
                  </marker>
                </defs>
                <Arrow f={f} at={draw1} d="M1214 240 C 1190 240, 1190 250, 1168 250" />
                <Arrow f={f} at={draw2} d="M1214 560 C 1180 560, 1190 540, 1168 540" />
              </svg>
            </div>
          </div>
          {/* cursor, in window space */}
          <div style={{position: 'absolute', left: cx - 120, top: cy - 190, opacity: cursorShow}}>
            {clickRing > 0 && (
              <div style={{position: 'absolute', left: -30 * clickRing - 4, top: -30 * clickRing - 4, width: 60 * clickRing + 8, height: 60 * clickRing + 8, borderRadius: 99, border: `3px solid ${C.marker}`, opacity: 1 - clickRing}} />
            )}
            <svg width={30} height={42} viewBox="0 0 24 34" style={{filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))'}}>
              <path d="M2 2 L2 26 L8.5 20 L13 30 L17 28.2 L12.6 18.5 L21 18.5 Z" fill="#111" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          {/* dock */}
          <div style={{position: 'absolute', left: '50%', bottom: 18, transform: `translateX(-50%) translateY(${(1 - ramp(f, 20, 16)) * 80}px)`, display: 'flex', gap: 6, padding: 8, borderRadius: 16, background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,.12)'}}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} style={{width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: (i === 0 && f > dbl && f < pop1 + 10) ? '#efede7' : 'transparent'}}>
                <div style={{width: 18, height: 18, borderRadius: i === 0 ? 4 : 99, border: '2.2px solid #6b675f', opacity: 0.85}} />
              </div>
            ))}
          </div>
        </div>
        <div style={{position: 'absolute', right: 150, top: 80, display: 'flex', gap: 10}}>
          {chips.map((c, i) => (
            <div key={c} style={{transform: `scale(${pop(f, 200 + i * 7, 14)})`}}>
              <Chip p={Math.min(1, pop(f, 200 + i * 7, 14))} dot={[C.marker, C.red, C.green, C.blue][i]} size={22}>
                {c}
              </Chip>
            </div>
          ))}
        </div>
      </div>
    </Paper>
  );
};

/* ---- Write: a note taking shape with the format bar --------------------------- */
const FMT = ['B', 'I', 'U', 'S', '|', 'H', 'H2', '•', '1.', '|', 'mark', 'link'];

export const WriteScene: React.FC = () => {
  const f = useCurrentFrame();
  const exit = exitOf(f, SCENES.write, 7);
  const [hClick, markClick] = CUES.write.click;
  const imgPop = pop(f, CUES.write.pop[0], 18);
  const heading = ramp(f, hClick + 2, 10);
  const lines = ['Hook in the first 5 seconds', 'One face, three words', 'End with a question'];
  const inP = ramp(f, 0, 24);
  const markP = ramp(f, markClick + 2, 16);
  const used = (k: string) => (k === 'H' && f >= hClick && f < hClick + 20) || (k === 'mark' && f >= markClick && f < markClick + 20) || (k === '•' && f >= 52 && f < 70);
  return (
    <Paper drift={f * 0.6}>
      <div style={{position: 'absolute', inset: 0, opacity: exit}}>
        <div style={{position: 'absolute', left: 140, top: 0, bottom: 0, width: 640, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 18}}>
            <span style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 96, lineHeight: 1, color: C.ink, opacity: ramp(f, 0, 10)}}>04</span>
            <span style={{fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.muted}}>Write</span>
          </div>
          <div style={{marginTop: 24, fontFamily: F.serif, fontSize: 84, lineHeight: 1.04, color: C.text}}>
            <Words f={f} start={4} gap={3} text="Write ideas your way." mark="way" markAt={CUES.write.swish[0]} />
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40}}>
            {['Headings & lists', 'Highlight words', 'Paste images'].map((c, i) => (
              <div key={c} style={{transform: `scale(${pop(f, 30 + i * 6, 14)})`, transformOrigin: 'left center'}}>
                <Chip p={Math.min(1, pop(f, 30 + i * 6, 14))} dot={[C.blue, C.marker, C.green][i]}>
                  {c}
                </Chip>
              </div>
            ))}
          </div>
        </div>
        <div style={{position: 'absolute', left: 880, top: 170, width: 880, transform: `translateY(${(1 - inP) * 160}px) rotate(${(1 - inP) * 3}deg)`, opacity: inP}}>
          <div style={{display: 'inline-flex', gap: 4, padding: 6, borderRadius: 14, background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,.12)', marginBottom: 16, fontFamily: F.sans, fontWeight: 700, fontSize: 18, color: C.muted}}>
            {FMT.map((k, i) =>
              k === '|' ? (
                <span key={i} style={{width: 1, background: 'rgba(0,0,0,.08)', margin: '6px 4px'}} />
              ) : (
                <span key={i} style={{width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 9, background: used(k) ? '#efede7' : 'transparent', color: used(k) ? C.text : C.muted, transform: `scale(${used(k) ? 1.12 : 1})`}}>
                  {k === 'mark' ? <span style={{width: 18, height: 18, borderRadius: 99, background: C.marker}} /> : k === 'link' ? '⌁' : k}
                </span>
              ),
            )}
          </div>
          <div style={{background: '#fff', borderRadius: 22, padding: '34px 40px', minHeight: 560, boxShadow: '0 2px 6px rgba(20,18,15,.08), 0 40px 90px rgba(20,18,15,.22)', fontFamily: F.sans, color: C.text}}>
            <div style={{fontSize: 30 + heading * 18, fontWeight: 500 + Math.round(heading * 3) * 100, letterSpacing: `${-0.02 * heading}em`, lineHeight: 1.15}}>
              {typed(f, 'Video plan', 12, 0.7)}
              {f < 50 && <Caret f={f} />}
            </div>
            <div style={{marginTop: 18}}>
              {lines.map((t, i) => {
                const st = 54 + i * 12;
                return (
                  <div key={t} style={{display: 'flex', gap: 14, fontSize: 28, lineHeight: 1.5, opacity: ramp(f, st - 2, 6)}}>
                    <span style={{color: C.muted}}>•</span>
                    <span>
                      {i === 1 ? <Marker p={markP}>{typed(f, t, st, 2.2)}</Marker> : typed(f, t, st, 2.2)}
                      {f >= st && f < st + 12 && <Caret f={f} />}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{marginTop: 22, width: 420, borderRadius: 14, overflow: 'hidden', transform: `scale(${imgPop})`, transformOrigin: 'left top', boxShadow: '0 10px 24px rgba(0,0,0,.15)'}}>
              <Img src={img('thumb-2')} style={{width: '100%', display: 'block'}} />
            </div>
          </div>
        </div>
      </div>
    </Paper>
  );
};

/* ---- Quick hits ----------------------------------------------------------------- */
const HITS: {bg: string; fg: string; text: React.ReactNode; sub: string}[] = [
  {bg: C.paper, fg: C.text, text: <>Yours alone.</>, sub: 'Everything stays in your browser. No account, no servers.'},
  {bg: C.night, fg: C.fgDark, text: <>Light, or dark.</>, sub: 'Follows your system, or pick one.'},
  {bg: C.marker, fg: C.ink, text: <>English & <span style={{fontFamily: 'var(--bn)'}}>বাংলা</span></>, sub: 'The whole interface, in your language.'},
  {bg: C.navy, fg: '#ffffff', text: <>Free.</>, sub: 'Every feature. No catch.'},
];

export const Hits: React.FC = () => {
  const f = useCurrentFrame();
  const i = Math.min(HITS.length - 1, Math.floor(f / 30));
  const local = f - i * 30;
  const h = HITS[i];
  const prev = HITS[Math.max(0, i - 1)];
  const wipe = i === 0 ? 1 : ramp(local, 0, 10);
  const s = pop(local, 0, 16);
  return (
    <Fill bg={prev.bg} style={{['--bn' as string]: F.bn}}>
      <div style={{position: 'absolute', inset: 0, background: h.bg, clipPath: `circle(${wipe * 120}% at ${i % 2 ? 90 : 10}% 50%)`}} />
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22}}>
        <div style={{fontFamily: F.serif, fontSize: 190, lineHeight: 1, color: h.fg, letterSpacing: '-0.02em', transform: `scale(${0.7 + Math.min(1.2, s) * 0.3}) rotate(${(1 - ramp(local, 0, 14)) * (i % 2 ? 4 : -4)}deg)`, opacity: Math.min(1, s * 2)}}>
          {h.text}
        </div>
        <Reveal p={ramp(local, 6, 12)}>
          <div style={{fontFamily: F.sans, fontWeight: 500, fontSize: 34, color: h.fg, opacity: 0.72}}>{h.sub}</div>
        </Reveal>
      </div>
    </Fill>
  );
};

/* ---- End card ------------------------------------------------------------------- */
export const End: React.FC = () => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [SCENES.end - 18, SCENES.end], [1, 0], clamp);
  return (
    <Paper drift={f * 0.3}>
      {Array.from({length: 10}).map((_, i) => {
        const r = (k: string) => random(`end-${k}-${i}`);
        const a = (i / 10) * Math.PI * 2 + f * 0.004;
        const rx = 760 + r('d') * 120;
        const ry = 380 + r('e') * 80;
        return (
          <div key={i} style={{position: 'absolute', left: 960 + Math.cos(a) * rx - 60, top: 540 + Math.sin(a) * ry - 60, opacity: 0.55 * ramp(f, i * 2, 20) * fade, transform: `rotate(${(r('r') - 0.5) * 20}deg)`}}>
            <Tile seed={900 + i} size={120} />
          </div>
        );
      })}
      <div style={{position: 'absolute', inset: 0, opacity: fade, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{opacity: ramp(f, 0, 14), transform: `scale(${0.9 + ramp(f, 0, 30) * 0.1})`}}>
          <Logo f={0} width={250} built />
        </div>
        <Reveal p={ramp(f, 14, 18)} style={{marginTop: 44}}>
          <div style={{fontFamily: F.serif, fontSize: 88, color: C.text, letterSpacing: '-0.015em', textAlign: 'center'}}>
            Turn information into <Marker p={ramp(f, CUES.end.swish[0], 20)}>knowledge.</Marker>
          </div>
        </Reveal>
        <div
          style={{
            marginTop: 42,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: C.navy,
            color: '#fff',
            borderRadius: 999,
            padding: '22px 40px',
            fontFamily: F.sans,
            fontWeight: 700,
            fontSize: 32,
            opacity: ramp(f, 30, 14),
            transform: `scale(${pop(f, 30, 16)})`,
            boxShadow: '0 18px 40px rgba(31,42,68,.3)',
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.marker} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          Add to Chrome. It’s free.
        </div>
        <div style={{marginTop: 26, fontFamily: F.sans, fontWeight: 500, fontSize: 26, color: C.muted, opacity: ramp(f, 40, 14)}}>fahadmahmud2004.github.io/thirdnote</div>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 54, textAlign: 'center', fontFamily: F.sans, fontWeight: 500, fontSize: 22, color: C.muted, opacity: ramp(f, 50, 14) * fade}}>
        Made by Fahad Mahmud · fahadmahmud.com
      </div>
    </Paper>
  );
};
