import {Easing, interpolate} from 'remotion';
import {loadFont as loadSerif} from '@remotion/google-fonts/InstrumentSerif';
import {loadFont as loadSans} from '@remotion/google-fonts/Inter';
import {loadFont as loadBangla} from '@remotion/google-fonts/HindSiliguri';
import timeline from './timeline.json';

// Same palette as the extension and its store art.
export const C = {
  night: '#0b1022',
  night2: '#121a33',
  navy: '#1f2a44',
  ink: '#141b33',
  paper: '#f4f1ea',
  paper2: '#ebe6db',
  card: '#ffffff',
  text: '#1d1c1a',
  muted: '#6f6b64',
  line: '#e3ddd1',
  marker: '#f2c94c',
  red: '#eb6f5c',
  green: '#4cb871',
  blue: '#5b8def',
  fgDark: '#eef1f8',
  mutedDark: '#8f99b8',
};

export const F = {
  serif: loadSerif('normal', {weights: ['400'], subsets: ['latin']}).fontFamily,
  sans: loadSans('normal', {weights: ['400', '500', '600', '700', '800'], subsets: ['latin']}).fontFamily,
  bn: loadBangla('normal', {weights: ['500', '700'], subsets: ['bengali', 'latin']}).fontFamily,
};
loadSerif('italic', {weights: ['400'], subsets: ['latin']});

// Scene lengths and sound cues live in timeline.json, which the score
// script reads too, so the music lands on the cuts.
export const SCENES = Object.fromEntries(timeline.scenes) as Record<string, number>;
export const TOTAL = timeline.scenes.reduce((s, [, n]) => s + (n as number), 0);
export const CUES = timeline.cues as Record<string, Record<string, number[]>>;

export const expoOut = Easing.bezier(0.16, 1, 0.3, 1);
export const smooth = Easing.bezier(0.65, 0, 0.35, 1);

// 0 to 1 over [start, start + dur], eased.
export const ramp = (f: number, start: number, dur = 18, easing = expoOut) =>
  interpolate(f, [start, start + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});

// Value at frame f along [frame, value] keys.
export const keys = (f: number, ks: [number, number][], easing = smooth) =>
  ks.length < 2
    ? ks[0][1]
    : interpolate(f, ks.map((k) => k[0]), ks.map((k) => k[1]), {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});
