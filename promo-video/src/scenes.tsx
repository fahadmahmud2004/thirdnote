import React from 'react';
import {interpolate, random, useCurrentFrame} from 'remotion';
import {C, CUES, F, SCENES, expoOut, ramp} from './theme';
import {Browser, Camera, Chip, Cursor, Fill, Logo, Marker, Paper, PanelWindow, Rect, Reveal, ShotKey} from './kit';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const exitOf = (f: number, dur: number, len = 8) => interpolate(f, [dur - len, dur], [1, 0], clamp);

/* ---- 1. The flood: answers rushing past, and forgotten -------------------- */
const STREAM = [
  'Entropy measures how many arrangements a system can have.',
  'In short, the SN2 reaction happens in a single step.',
  'Here are five hooks for your next video intro.',
  'Akbar introduced the mansabdari system to rank officials.',
  'A derivative tells you the rate of change at a point.',
  'Photosynthesis turns light, water and CO2 into glucose.',
  'Great question! Let me break this down step by step.',
  'The key idea is that heat flows from hot to cold.',
  'Here is a simple way to remember the Krebs cycle.',
  'Thumbnails with one face and three words perform best.',
  'Newton’s second law: force equals mass times acceleration.',
  'To summarise the chapter, there are three main points.',
  'Let me explain this with an everyday example.',
  'The mitochondria is the powerhouse of the cell.',
  'Here is a 7-day study plan you can actually follow.',
  'Ohm’s law relates voltage, current and resistance.',
];

const LINES = ['You ask AI a hundred questions.', 'You get brilliant answers.', 'Then they scroll away.', 'And by tomorrow, you forget.'];

export const Flood: React.FC = () => {
  const f = useCurrentFrame();
  const idx = Math.min(3, Math.floor(f / 60));
  const local = f - idx * 60;
  const speed = f * 3 + f * f * 0.03;
  const count = Math.floor(interpolate(f, [0, 230], [0, 1284], {...clamp, easing: (t) => t * t}));
  const exit = exitOf(f, SCENES.flood, 10);
  return (
    <Fill bg={C.night} style={{opacity: exit}}>
      {[0, 1, 2].map((col) => (
        <div
          key={col}
          style={{
            position: 'absolute',
            left: 90 + col * 600,
            top: 0,
            width: 560,
            transform: `translateY(${-((speed * (1 + col * 0.18) + col * 400) % 2600)}px)`,
            filter: `blur(${Math.min(2.5, f / 90)}px)`,
          }}
        >
          {[...STREAM, ...STREAM, ...STREAM].map((s, i) => (
            <div
              key={i}
              style={{
                fontFamily: F.sans,
                fontSize: 24,
                lineHeight: 1.5,
                color: C.mutedDark,
                opacity: 0.18 + 0.12 * random(`o${col}-${i}`),
                marginBottom: 34,
                padding: '16px 20px',
                borderRadius: 14,
                background: i % 3 === 0 ? 'rgba(255,255,255,.035)' : 'transparent',
              }}
            >
              {s}
            </div>
          ))}
        </div>
      ))}
      <Fill bg="radial-gradient(ellipse 60% 45% at 50% 50%, rgba(11,16,34,.96) 35%, rgba(11,16,34,.55) 80%, rgba(11,16,34,.25) 100%)" />
      <div style={{position: 'absolute', top: 64, right: 90, fontFamily: F.sans, fontWeight: 600, fontSize: 22, color: C.mutedDark, fontVariantNumeric: 'tabular-nums'}}>
        {count.toLocaleString('en-US')} messages scrolled
      </div>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 160px'}}>
        {idx < 3 ? (
          <Reveal p={ramp(local, 2, 16)} style={{transform: idx === 2 ? `translateY(${-ramp(local, 24, 36) * 60}px)` : undefined, opacity: idx === 2 ? 1 - ramp(local, 30, 26) : 1, filter: idx === 2 ? `blur(${ramp(local, 30, 26) * 8}px)` : undefined}}>
            <div style={{fontFamily: F.serif, fontSize: 112, lineHeight: 1.05, color: C.fgDark, letterSpacing: '-0.01em'}}>{LINES[idx]}</div>
          </Reveal>
        ) : (
          <div style={{fontFamily: F.serif, fontSize: 112, lineHeight: 1.05, color: C.fgDark}}>
            {'And by tomorrow, you '.split('').map((ch, i) => (
              <span key={i} style={{opacity: ramp(local, i * 0.6, 10)}}>{ch}</span>
            ))}
            <span style={{fontStyle: 'italic', color: C.marker}}>
              {'forget.'.split('').map((ch, i) => {
                const go = ramp(local, 30 + i * 2, 22);
                return (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      opacity: ramp(local, 12, 8) * (1 - go),
                      filter: `blur(${go * 10}px)`,
                      transform: `translate(${go * (random(`x${i}`) - 0.5) * 160}px, ${-go * (40 + random(`y${i}`) * 120)}px)`,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          </div>
        )}
      </div>
    </Fill>
  );
};

/* ---- 2. The mark: everything stops, one line gets highlighted ------------- */
export const Mark: React.FC = () => {
  const f = useCurrentFrame();
  const sweep = ramp(f, CUES.mark.swish[0], 24, expoOut);
  const fill = ramp(f, CUES.mark.fill[0], 30, (t) => t * t * t);
  return (
    <Fill bg={C.night}>
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 46}}>
        <div style={{position: 'relative', fontFamily: F.serif, fontSize: 78, color: C.fgDark, opacity: ramp(f, 0, 12)}}>
          <span
            style={{
              position: 'absolute',
              left: '-0.15em',
              right: '-0.15em',
              top: '12%',
              bottom: '2%',
              background: C.marker,
              borderRadius: 10,
              transformOrigin: 'left center',
              transform: `scaleX(${sweep}) scaleY(${1 + fill * 18}) skewX(${-6 * (1 - fill)}deg)`,
            }}
          />
          <span style={{position: 'relative', opacity: 1 - fill}}>Entropy never decreases in an isolated system.</span>
          <span style={{position: 'absolute', inset: 0, color: C.ink, clipPath: `inset(0 ${(1 - sweep) * 100}% 0 0)`, opacity: 1 - fill}}>
            Entropy never decreases in an isolated system.
          </span>
        </div>
        <div style={{opacity: 1 - fill * 3}}>
          <Reveal p={ramp(f, 54, 18)}>
            <div style={{fontFamily: F.sans, fontWeight: 600, fontSize: 34, color: C.mutedDark, letterSpacing: '0.01em'}}>
              Keep the line that matters.
            </div>
          </Reveal>
        </div>
      </div>
    </Fill>
  );
};

/* ---- 3. The logo builds itself on paper ----------------------------------- */
export const LogoScene: React.FC = () => {
  const f = useCurrentFrame();
  const open = ramp(f, 0, 20);
  const exit = exitOf(f, SCENES.logo, 8);
  const tag = ramp(f, CUES.logo.swish[0], 20);
  return (
    <Fill bg={C.marker}>
      <div style={{position: 'absolute', inset: 0, clipPath: `circle(${open * 75}% at 50% 50%)`, opacity: exit}}>
        <Paper drift={f * 0.4}>
          <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 46}}>
            <div style={{transform: `scale(${1.06 - ramp(f, 0, 60) * 0.06})`}}>
              <Logo f={f - 6} width={430} />
            </div>
            <Reveal p={ramp(f, 62, 18)}>
              <div style={{fontFamily: F.serif, fontSize: 70, color: C.text, letterSpacing: '-0.01em'}}>
                Capture everything. <Marker p={tag}>Remember anything.</Marker>
              </div>
            </Reveal>
          </div>
        </Paper>
      </div>
    </Fill>
  );
};

/* ---- 4-9. Feature chapters ------------------------------------------------ */
export type FeatureProps = {
  scene: string;
  num: string;
  label: string;
  title: [string, string, string?];
  chips: {text: string; dot?: string}[];
  url: string;
  shots: ShotKey[];
  cam?: Camera;
  cursor?: Cursor;
  rect?: Rect;
  flip?: number;
  panel?: {at: number; shots: ShotKey[]};
  marquee?: {text: string; dot: string}[];
};

export const Feature: React.FC<FeatureProps> = (p) => {
  const f = useCurrentFrame();
  const dur = SCENES[p.scene];
  const swish = CUES[p.scene]?.swish?.[0] ?? 24;
  const inP = ramp(f, 2, 30);
  const exit = exitOf(f, dur, 7);
  const panelIn = p.panel ? ramp(f, p.panel.at, 24) : 0;
  return (
    <Paper drift={f * 0.35}>
      <div style={{position: 'absolute', inset: 0, opacity: exit}}>
        {/* copy */}
        <div style={{position: 'absolute', left: 150, top: 0, bottom: p.marquee ? 120 : 0, width: 600, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: 18, opacity: ramp(f, 0, 12)}}>
            <span style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 92, lineHeight: 1, color: C.ink}}>{p.num}</span>
            <span style={{fontFamily: F.sans, fontWeight: 700, fontSize: 22, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.muted}}>{p.label}</span>
          </div>
          <Reveal p={ramp(f, 6, 20)} style={{marginTop: 26}}>
            <div style={{fontFamily: F.serif, fontSize: 84, lineHeight: 1.04, color: C.text, letterSpacing: '-0.015em'}}>
              {p.title[0]}
              <Marker p={ramp(f, swish, 20)}>{p.title[1]}</Marker>
              {p.title[2] ?? ''}
            </div>
          </Reveal>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40}}>
            {p.chips.map((c, i) => (
              <Chip key={c.text} p={ramp(f, 40 + i * 7, 14)} dot={c.dot}>
                {c.text}
              </Chip>
            ))}
          </div>
        </div>
        {/* screen */}
        <div
          style={{
            position: 'absolute',
            left: 790,
            top: p.marquee ? 150 : 205,
            transform: `perspective(2400px) translateY(${(1 - inP) * 120}px) rotateY(${-9 + inP * 4}deg) rotateX(${(1 - inP) * 6}deg)`,
            transformOrigin: 'left center',
            opacity: Math.min(1, inP * 1.6),
          }}
        >
          <Browser f={f} width={1040} url={p.url} shots={p.shots} cam={p.cam} cursor={p.cursor} rect={p.rect} flip={p.flip} />
        </div>
        {p.panel && (
          <div
            style={{
              position: 'absolute',
              right: 70,
              top: 150,
              transform: `translateX(${(1 - panelIn) * 520}px) rotate(${(1 - panelIn) * 3}deg)`,
              opacity: Math.min(1, panelIn * 2),
            }}
          >
            <PanelWindow f={f} width={330} shots={p.panel.shots} />
          </div>
        )}
        {p.marquee && (
          <div style={{position: 'absolute', left: 0, right: 0, bottom: 64, overflow: 'hidden', opacity: ramp(f, 30, 20)}}>
            <div style={{display: 'flex', gap: 14, transform: `translateX(${-f * 3.2}px)`, width: 'max-content'}}>
              {[...p.marquee, ...p.marquee, ...p.marquee].map((m, i) => (
                <Chip key={i} p={1} dot={m.dot} size={24}>
                  {m.text}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
    </Paper>
  );
};

/* ---- 10. Quick hits -------------------------------------------------------- */
const HITS: {bg: string; fg: string; mark?: string; text: React.ReactNode; sub: string}[] = [
  {bg: C.paper, fg: C.text, text: <>Yours alone.</>, sub: 'Everything stays in your browser. No account, no servers.'},
  {bg: C.night, fg: C.fgDark, text: <>Light, or dark.</>, sub: 'Follows your system, or pick one.'},
  {bg: C.marker, fg: C.ink, text: <>English & <span style={{fontFamily: 'var(--bn)'}}>বাংলা</span></>, sub: 'The whole interface, in your language.'},
  {bg: C.navy, fg: '#ffffff', text: <>Free.</>, sub: 'Every feature. No catch.'},
];

export const Extras: React.FC = () => {
  const f = useCurrentFrame();
  const i = Math.min(HITS.length - 1, Math.floor(f / 30));
  const local = f - i * 30;
  const h = HITS[i];
  return (
    <Fill bg={h.bg} style={{['--bn' as string]: F.bn}}>
      {i === 1 && <div style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${50 - ramp(local, 0, 20) * 50}%`, background: C.paper}} />}
      <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, transform: `scale(${1.06 - ramp(local, 0, 30) * 0.06})`}}>
        <Reveal p={ramp(local, 0, 12)}>
          <div style={{fontFamily: F.serif, fontSize: 180, lineHeight: 1, color: h.fg, letterSpacing: '-0.02em'}}>{h.text}</div>
        </Reveal>
        <Reveal p={ramp(local, 6, 12)}>
          <div style={{fontFamily: F.sans, fontWeight: 500, fontSize: 34, color: h.fg, opacity: 0.72}}>{h.sub}</div>
        </Reveal>
      </div>
    </Fill>
  );
};

/* ---- 11. End card ---------------------------------------------------------- */
export const End: React.FC = () => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [SCENES.end - 18, SCENES.end], [1, 0], clamp);
  return (
    <Paper drift={f * 0.3}>
      <div style={{position: 'absolute', inset: 0, opacity: fade, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{opacity: ramp(f, 0, 14), transform: `scale(${0.94 + ramp(f, 0, 30) * 0.06})`}}>
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
            transform: `translateY(${(1 - ramp(f, 30, 20)) * 20}px)`,
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
        <div style={{marginTop: 26, fontFamily: F.sans, fontWeight: 500, fontSize: 26, color: C.muted, opacity: ramp(f, 40, 14)}}>
          fahadmahmud2004.github.io/thirdnote
        </div>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 54, textAlign: 'center', fontFamily: F.sans, fontWeight: 500, fontSize: 22, color: C.muted, opacity: ramp(f, 50, 14) * fade}}>
        Made by Fahad Mahmud · fahadmahmud.com
      </div>
    </Paper>
  );
};
