import { CHORD_PATTERN, type Recipe } from '../recipes/schema';

export const NOTE_PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export interface Chord {
  symbol: string;
  /** Scale degree 0–6 of the root. */
  degree: number;
  rootPc: number;
  /** Pitch classes, root first, then 3rd/5th and any extensions. */
  pcs: number[];
  bassPc: number;
}

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function parseChord(symbol: string, keyPc: number, scale: ScaleName): Chord {
  const m = CHORD_PATTERN.exec(symbol);
  if (!m) throw new Error(`Bad chord symbol "${symbol}"`);
  const [, numeral, mark, ext, inv] = m;
  const acc = symbol.startsWith('b') ? -1 : symbol.startsWith('#') ? 1 : 0;
  const degree = NUMERALS.indexOf(numeral.toUpperCase());
  const steps = SCALES[scale];
  const rootPc = mod12(keyPc + steps[degree] + acc);
  const lower = numeral === numeral.toLowerCase();

  let third = lower ? 3 : 4;
  let fifth = 7;
  if (mark === 'o' || mark === 'ø') {
    third = 3;
    fifth = 6;
  } else if (mark === '+') {
    third = 4;
    fifth = 8;
  }

  const intervals = [0, third, fifth];
  const diatonicSeventh = mod12(steps[(degree + 6) % 7] - steps[degree]);
  const seventh = mark === 'ø' ? 10 : mark === 'o' ? 9 : ext === 'maj7' ? 11 : diatonicSeventh;

  if (ext === 'sus2') intervals[1] = 2;
  if (ext === 'sus4') intervals[1] = 5;
  if (ext === '7' || ext === 'maj7' || ext === '9') intervals.push(seventh);
  if (ext === 'add9' || ext === '9') intervals.push(14);

  const pcs = intervals.map((i) => mod12(rootPc + i));
  let bassPc = rootPc;
  if (inv === '/3') bassPc = pcs[1];
  else if (inv === '/5') bassPc = pcs[2];
  else if (inv === '/7' && pcs.length > 3) bassPc = pcs[3];

  return { symbol, degree, rootPc, pcs, bassPc };
}

/** Split a progression bar like "IV V" into chords with their beat offsets. */
export function parseBar(bar: string, recipe: Pick<Recipe, 'key' | 'scale' | 'meter'>): { chord: Chord; at: number; len: number }[] {
  const symbols = bar.trim().split(/\s+/);
  const keyPc = NOTE_PC[recipe.key];
  const beatsEach = recipe.meter / symbols.length;
  return symbols.map((s, i) => ({ chord: parseChord(s, keyPc, recipe.scale), at: i * beatsEach, len: beatsEach }));
}

/** MIDI note with pitch class `pc` closest to `around`. */
export function nearestPitch(pc: number, around: number): number {
  const base = around - mod12(around - pc);
  return around - base > 6 ? base + 12 : base;
}

/** All MIDI notes of the scale within [low, high]. */
export function scaleNotes(keyPc: number, scale: ScaleName, low: number, high: number): number[] {
  const pcs = new Set(SCALES[scale].map((s) => mod12(keyPc + s)));
  const out: number[] = [];
  for (let n = low; n <= high; n++) if (pcs.has(mod12(n))) out.push(n);
  return out;
}

/** Close-position voicing of `count` notes whose lowest note sits at or above `floor`. */
export function closeVoicing(pcs: number[], floor: number, count = pcs.length): number[] {
  const notes: number[] = [];
  let cursor = floor;
  for (let i = 0; i < count; i++) {
    const pc = pcs[i % pcs.length];
    let n = cursor + mod12(pc - cursor);
    if (notes.length && n <= notes[notes.length - 1]) n += 12;
    notes.push(n);
    cursor = n + 1;
  }
  return notes;
}

/**
 * Choose the inversion of `pcs` (around `center`) that moves least from `prev`.
 * Keeps sustained parts (pads, strings) smooth from chord to chord.
 */
export function voiceLead(pcs: number[], prev: number[] | null, center: number, count = Math.min(4, Math.max(3, pcs.length))): number[] {
  const candidates: number[][] = [];
  const triadish = pcs.slice(0, count);
  for (let rot = 0; rot < triadish.length; rot++) {
    const rotated = [...triadish.slice(rot), ...triadish.slice(0, rot)];
    for (const floor of [center - 7, center - 2, center + 3]) {
      candidates.push(closeVoicing(rotated, floor, count));
    }
  }
  const score = (v: number[]) => {
    const spreadPenalty = Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 0.5;
    if (!prev || prev.length !== v.length) return spreadPenalty;
    return v.reduce((sum, n, i) => sum + Math.abs(n - prev[i]), 0) + spreadPenalty * 0.3;
  };
  return candidates.reduce((best, c) => (score(c) < score(best) ? c : best));
}

export const isChordTone = (midi: number, chord: Chord) => chord.pcs.includes(mod12(midi));

/** Chord tone nearest to `midi` (ties resolve downward). */
export function snapToChord(midi: number, chord: Chord): number {
  let best = midi;
  let bestDist = Infinity;
  for (const pc of chord.pcs) {
    const n = nearestPitch(pc, midi);
    const d = Math.abs(n - midi);
    if (d < bestDist || (d === bestDist && n < best)) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}
