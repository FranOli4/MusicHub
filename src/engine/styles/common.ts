import type { InstrumentId, Recipe, Space, StyleId } from '../../recipes/schema';
import { generateMelody, makeMotif, type MelodyOptions, type Motif } from '../melody';
import { Rng } from '../rng';
import { THEMES, themeBeats } from '../themes';
import { closeVoicing, mod12, nearestPitch, voiceLead } from '../theory';
import type { NoteEvent, PhraseContext } from '../types';

/** Sustained, voice-led chords (pads, string sections). */
export function sustain(ctx: PhraseContext, i: InstrumentId, center: number, v: number, count = 4): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const { chord, at, len } of ctx.chords) {
    const voicing = voiceLead(chord.pcs, prev, center, Math.min(count, Math.max(3, chord.pcs.length)));
    prev = voicing;
    for (const m of voicing) out.push({ t: at, d: len, m, v, i });
  }
  return out;
}

export interface BassOptions {
  /** Lowest allowed note. */
  low: number;
  /** Beats between notes; 0 = one note per chord. */
  step: number;
  v: number;
  /** Fraction of the step the note sounds for. */
  gate?: number;
  /** Alternate root and octave. */
  octaves?: boolean;
}

export function bassLine(ctx: PhraseContext, i: InstrumentId, o: BassOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const { chord, at, len } of ctx.chords) {
    const root = o.low + mod12(chord.bassPc - o.low);
    const step = o.step || len;
    let k = 0;
    for (let t = at; t < at + len - 1e-6; t += step, k++) {
      const m = o.octaves && k % 2 === 1 ? root + 12 : root;
      const strong = Math.abs((t - at) % ctx.meter) < 1e-6;
      out.push({ t, d: Math.min(step, at + len - t) * (o.gate ?? 0.95), m, v: o.v * (strong ? 1 : 0.85), i });
    }
  }
  return out;
}

export interface FigureOptions {
  /** Indexes into the voicing (0 = lowest note). */
  pattern: number[];
  step: number;
  floor: number;
  /** Notes in the voicing; > chord size wraps into the next octave. */
  span?: number;
  v: number;
  gate?: number;
}

/** Broken-chord figures: arpeggios, Alberti bass, violin figuration. */
export function figure(ctx: PhraseContext, i: InstrumentId, o: FigureOptions): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const { chord, at, len } of ctx.chords) {
    const triad = chord.pcs.slice(0, Math.min(chord.pcs.length, 4));
    const notes = closeVoicing(triad, o.floor, o.span ?? triad.length + 1);
    let k = 0;
    for (let t = at; t < at + len - 1e-6; t += o.step, k++) {
      const idx = o.pattern[k % o.pattern.length] % notes.length;
      const accent = Math.abs((t - at) % 1) < 1e-6 ? 1 : 0.85;
      out.push({ t, d: o.step * (o.gate ?? 0.9), m: notes[idx], v: o.v * accent, i });
    }
  }
  return out;
}

/** Block chords repeated every `step` beats (classical accompaniment, continuo). */
export function repeatedChords(ctx: PhraseContext, i: InstrumentId, o: { step: number; floor: number; count: number; v: number; gate?: number }): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const { chord, at, len } of ctx.chords) {
    const voicing = voiceLead(chord.pcs, prev, o.floor + 6, o.count);
    prev = voicing;
    for (let t = at; t < at + len - 1e-6; t += o.step) {
      const strong = Math.abs((t - at) % ctx.meter) < 1e-6;
      for (const m of voicing) out.push({ t, d: o.step * (o.gate ?? 0.5), m, v: o.v * (strong ? 1 : 0.8), i });
    }
  }
  return out;
}

export interface MelodyFor extends MelodyOptions {
  rhythms3: number[][];
  rhythms4: number[][];
  maxLeap?: number;
  v: number;
}

/**
 * The section's melody: the recipe's motif, a quoted theme, or a motif derived from the seed.
 * A quoted theme is stated plainly; "develop" passes replace it with fresh melody over the same chords.
 */
export function melody(ctx: PhraseContext, i: InstrumentId, o: MelodyFor): NoteEvent[] {
  const motifRng = Rng.from(ctx.seed, 'motif', ctx.section);
  const motif: Motif =
    ctx.recipe.motif ?? makeMotif(motifRng, ctx.meter === 3 ? o.rhythms3 : o.rhythms4, o.maxLeap ?? 3);
  const shift = ctx.variation.register;
  const opts = { ...o, low: o.low + shift, high: o.high + shift, center: o.center + shift };
  const generated = generateMelody(ctx, motif, ctx.rng, opts);

  const theme = ctx.recipe.theme ? THEMES[ctx.recipe.theme] : null;
  if (theme && theme.section === ctx.section && theme.meter === ctx.meter && !ctx.variation.develop) {
    const tonic = nearestPitch(ctx.keyPc, opts.center - 3);
    const quoted: NoteEvent[] = [];
    let t = 0;
    for (const [offset, d] of theme.notes) {
      if (offset !== null) quoted.push({ t, d, m: tonic + offset, v: o.v * (Math.abs(t % ctx.meter) < 1e-6 ? 0.8 : 0.7), i });
      t += d;
    }
    const covered = themeBeats(theme);
    return [...quoted, ...generated.filter((n) => n.t >= covered).map((n) => ({ ...n, v: n.v * o.v, i }))];
  }
  return generated.map((n) => ({ ...n, v: n.v * o.v, i }));
}

// ---------- recipe helpers ----------

export const MAJOR_KEYS = ['C', 'D', 'Eb', 'E', 'F', 'G', 'A', 'Bb'] as const;
export const MINOR_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

export function tempoFor(rng: Rng, space: Space, think: [number, number], sleep: [number, number]): number {
  const [lo, hi] = space === 'think' ? think : sleep;
  return Math.round(rng.range(lo, hi));
}

export function buildRecipe(r: Omit<Recipe, 'version' | 'density' | 'brightness' | 'reverb'> & Partial<Pick<Recipe, 'density' | 'brightness' | 'reverb'>>): Recipe {
  return {
    version: 1,
    density: 0.5,
    brightness: 0.5,
    reverb: 0.4,
    ...r,
  };
}

export const keyName = (r: Pick<Recipe, 'key' | 'scale'>) => `${r.key} ${r.scale}`;

export type RecipeMaker = (rng: Rng, space: Space) => Recipe;
export type { StyleId };
