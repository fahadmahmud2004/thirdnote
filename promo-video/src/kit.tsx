import React from 'react';
import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {C, F, expoOut, keys, ramp} from './theme';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const Fill: React.FC<{bg?: string; children?: React.ReactNode; style?: React.CSSProperties}> = ({bg, children, style}) => (
  <div style={{position: 'absolute', inset: 0, background: bg, overflow: 'hidden', ...style}}>{children}</div>
);

// Text rising out of a mask.
export const Reveal: React.FC<{p: number; children: React.ReactNode; style?: React.CSSProperties}> = ({p, children, style}) => (
  <div style={{overflow: 'hidden', padding: '0.12em 0.04em 0.2em', margin: '-0.12em -0.04em -0.2em', ...style}}>
    <div style={{transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 2.5)}}>{children}</div>
  </div>
);

// A highlighter stroke sweeping behind a word, left to right.
export const Marker: React.FC<{p: number; color?: string; children: React.ReactNode; ink?: string; base?: string}> = ({
  p,
  color = C.marker,
  children,
  ink,
  base,
}) => (
  <span style={{position: 'relative', display: 'inline-block', whiteSpace: 'nowrap'}}>
    <span
      style={{
        position: 'absolute',
        left: '-0.08em',
        right: '-0.08em',
        top: '18%',
        bottom: '4%',
        background: color,
        borderRadius: '0.12em',
        transformOrigin: 'left center',
        transform: `scaleX(${p}) skewX(-6deg)`,
        opacity: 0.92,
      }}
    />
    <span style={{position: 'relative', color: base}}>{children}</span>
    {ink && (
      <span style={{position: 'absolute', inset: 0, color: ink, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`}}>{children}</span>
    )}
  </span>
);

// Notebook paper: faint ruled lines and a margin.
export const Paper: React.FC<{children?: React.ReactNode; drift?: number}> = ({children, drift = 0}) => (
  <Fill bg={C.paper}>
    <div
      style={{
        position: 'absolute',
        inset: '-60px 0 0 0',
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 55px, ${C.line} 55px 56px)`,
        transform: `translateY(${drift % 56}px)`,
        opacity: 0.7,
      }}
    />
    <div style={{position: 'absolute', top: 0, bottom: 0, left: 86, width: 2, background: '#efc9c0', opacity: 0.8}} />
    {children}
  </Fill>
);

/* ---- The TN logo, built piece by piece ----------------------------------- */
// Drawn on the brand's 1000-wide grid: top bar 40..940, wordmark under it.
export const Logo: React.FC<{f: number; width: number; dark?: boolean; word?: boolean; built?: boolean}> = ({
  f,
  width,
  dark = false,
  word = true,
  built = false,
}) => {
  const ink = dark ? '#ffffff' : C.ink;
  const at = (s: number, d = 16) => (built ? 1 : ramp(f, s, d));
  const bar = at(0, 14);
  const pencil = at(8, 18);
  const n = at(14, 18);
  const note = at(20, 18);
  const wordP = at(36, 20);
  const h = word ? 760 : 520;
  return (
    <svg width={width} height={(width * h) / 1000} viewBox={`0 -20 1000 ${h}`} style={{overflow: 'visible'}}>
      {/* note page */}
      <g style={{transform: `translateX(${(1 - note) * 140}px)`, opacity: note}}>
        <rect x="600" y="60" width="340" height="420" fill={C.marker} />
        {[180, 250, 320, 390].map((y, i) => (
          <rect
            key={y}
            x="690"
            y={y - 15}
            width={(i === 3 ? 130 : 190) * at(28 + i * 3, 10)}
            height="30"
            rx="15"
            fill={C.ink}
          />
        ))}
      </g>
      {/* N: its right leg is the page's left edge */}
      <path
        d="M330 150 H430 L520 340 V96 H620 V480 H520 L430 290 V480 H330 Z"
        fill={ink}
        style={{clipPath: `inset(0 0 ${(1 - n) * 100}% 0)`}}
      />
      {/* pencil: the T stem */}
      <g style={{transform: `translateY(${(1 - pencil) * -260}px)`, opacity: pencil}}>
        <rect x="160" y="96" width="120" height="250" fill={ink} />
        <path d="M160 346 H280 L220 480 Z" fill={C.marker} />
        <path d="M196 426 H244 L220 480 Z" fill={dark ? '#ffffff' : C.ink} />
      </g>
      {/* top bar: the T's crossbar and the page's top edge */}
      <rect x="40" y="0" width="900" height="96" rx="10" fill={ink} style={{transformOrigin: '40px 48px', transform: `scaleX(${bar})`}} />
      {word && (
        <text
          x="40"
          y="700"
          textLength="900"
          lengthAdjust="spacingAndGlyphs"
          style={{fontFamily: F.sans, fontWeight: 800, fontSize: 172, fill: ink, opacity: wordP, transform: `translateY(${(1 - wordP) * 40}px)`}}
        >
          ThirdNote
        </text>
      )}
    </svg>
  );
};

/* ---- A browser window showing real screens ------------------------------- */
// Screens are 1440x900 CSS px captures. Camera and cursor use those pixels.
export type ShotKey = {at: number; src: string};
export type Camera = {z: [number, number][]; x: [number, number][]; y: [number, number][]};
export type Cursor = {path: [number, number, number][]; clicks?: number[]; hideAt?: number};
export type Rect = {from: number; to: number; x1: number; y1: number; x2: number; y2: number};

const SW = 1440;
const SH = 900;

const shotOpacity = (f: number, shots: ShotKey[], i: number) => {
  const inP = i === 0 ? 1 : ramp(f, shots[i].at, 8);
  const next = shots[i + 1];
  // keep showing until the next one is fully in, so there is never a gap
  return next && f >= next.at + 8 ? 0 : inP;
};

const CursorView: React.FC<{f: number; c: Cursor; z: number}> = ({f, c, z}) => {
  const x = interpolate(f, c.path.map((p) => p[0]), c.path.map((p) => p[1]), {...clamp, easing: expoOut});
  const y = interpolate(f, c.path.map((p) => p[0]), c.path.map((p) => p[2]), {...clamp, easing: expoOut});
  const show = ramp(f, c.path[0][0] - 6, 8) * (c.hideAt ? 1 - ramp(f, c.hideAt, 8) : 1);
  const click = (c.clicks || []).find((k) => f >= k && f < k + 16);
  const dip = click !== undefined && f - click < 5 ? 0.82 : 1;
  const ring = click !== undefined ? (f - click) / 16 : 0;
  const s = 1.7 / z;
  return (
    <div style={{position: 'absolute', left: x, top: y, opacity: show, pointerEvents: 'none'}}>
      {click !== undefined && (
        <div
          style={{
            position: 'absolute',
            left: -40 * s * ring - 6,
            top: -40 * s * ring - 6,
            width: 80 * s * ring + 12,
            height: 80 * s * ring + 12,
            borderRadius: 999,
            border: `${3 * s}px solid ${C.marker}`,
            opacity: 1 - ring,
          }}
        />
      )}
      <svg width={24 * s} height={34 * s} viewBox="0 0 24 34" style={{transform: `scale(${dip})`, transformOrigin: '0 0', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))'}}>
        <path d="M2 2 L2 26 L8.5 20 L13 30 L17 28.2 L12.6 18.5 L21 18.5 Z" fill="#111" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

export const Browser: React.FC<{
  f: number;
  width: number;
  url: string;
  shots: ShotKey[];
  cam?: Camera;
  cursor?: Cursor;
  rect?: Rect;
  flip?: number;
}> = ({f, width, url, shots, cam, cursor, rect, flip}) => {
  const k = width / SW;
  const z = cam ? keys(f, cam.z) : 1;
  const fx = cam ? keys(f, cam.x) : SW / 2;
  const fy = cam ? keys(f, cam.y) : SH / 2;
  const angle =
    flip === undefined ? 0 : f < flip ? interpolate(f, [flip - 7, flip], [0, 90], clamp) : interpolate(f, [flip, flip + 9], [-90, 0], {...clamp, easing: expoOut});
  const bar = 44;
  return (
    <div
      style={{
        width,
        borderRadius: 16,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 2px 6px rgba(20,18,15,.08), 0 40px 90px rgba(20,18,15,.28)',
        border: '1px solid rgba(0,0,0,.06)',
      }}
    >
      <div style={{height: bar, background: '#f1eee8', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 9, borderBottom: '1px solid #e4dfd5'}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{width: 13, height: 13, borderRadius: 99, background: c}} />
        ))}
        <div
          style={{
            margin: '0 auto',
            background: '#fff',
            borderRadius: 9,
            padding: '6px 22px',
            fontFamily: F.sans,
            fontSize: 15,
            color: C.muted,
            minWidth: 360,
            textAlign: 'center',
            border: '1px solid #e4dfd5',
          }}
        >
          {url}
        </div>
        <span style={{width: 57}} />
      </div>
      <div style={{width, height: SH * k, overflow: 'hidden', position: 'relative', perspective: 1600}}>
        <div style={{width: SW, height: SH, transform: `scale(${k}) rotateY(${angle}deg)`, transformOrigin: '0 0'}}>
          <div style={{position: 'absolute', inset: 0, transformOrigin: `${fx}px ${fy}px`, transform: `scale(${z})`}}>
            {shots.map((s, i) => (
              <Img key={s.src} src={staticFile(`shots/${s.src}.png`)} style={{position: 'absolute', inset: 0, width: SW, height: SH, opacity: shotOpacity(f, shots, i)}} />
            ))}
            {rect && f >= rect.from && f < rect.to + 4 && (
              <div
                style={{
                  position: 'absolute',
                  left: rect.x1,
                  top: rect.y1,
                  width: (rect.x2 - rect.x1) * keys(f, [[rect.from, 0.02], [rect.to, 1]]),
                  height: (rect.y2 - rect.y1) * keys(f, [[rect.from, 0.02], [rect.to, 1]]),
                  border: '2px solid #fff',
                  boxShadow: '0 0 0 9999px rgba(15,14,12,.35)',
                  borderRadius: 4,
                }}
              />
            )}
            {cursor && <CursorView f={f} c={cursor} z={z} />}
          </div>
        </div>
      </div>
    </div>
  );
};

// A floating side panel window (the extension's side panel captures are 400x860).
export const PanelWindow: React.FC<{f: number; width: number; shots: ShotKey[]}> = ({f, width, shots}) => (
  <div
    style={{
      width,
      height: width * 2.15,
      borderRadius: 18,
      overflow: 'hidden',
      position: 'relative',
      background: C.paper,
      boxShadow: '0 2px 6px rgba(20,18,15,.1), 0 40px 90px rgba(20,18,15,.32)',
      border: '1px solid rgba(0,0,0,.06)',
    }}
  >
    {shots.map((s, i) => (
      <Img key={s.src} src={staticFile(`shots/${s.src}.png`)} style={{position: 'absolute', inset: 0, width: '100%', opacity: shotOpacity(f, shots, i)}} />
    ))}
  </div>
);

export const Chip: React.FC<{p: number; children: React.ReactNode; dot?: string; dark?: boolean; size?: number}> = ({
  p,
  children,
  dot = C.marker,
  dark = false,
  size = 26,
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: size * 0.45,
      padding: `${size * 0.42}px ${size * 0.85}px`,
      borderRadius: 999,
      background: dark ? 'rgba(255,255,255,.08)' : C.card,
      border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : C.line}`,
      boxShadow: dark ? 'none' : '0 1px 2px rgba(20,18,15,.05)',
      color: dark ? C.fgDark : C.text,
      fontFamily: F.sans,
      fontWeight: 600,
      fontSize: size,
      opacity: p,
      transform: `translateY(${(1 - p) * 20}px)`,
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{width: size * 0.4, height: size * 0.4, borderRadius: 99, background: dot, flexShrink: 0}} />
    {children}
  </div>
);
