import type { Rng } from './rng';
import { isChordTone, nearestPitch, scaleNotes, snapToChord, type Chord } from './theory';
import type { PhraseContext } from './types';

export interface Motif {
  steps: number[];
  rhythm: number[];
}

export interface MelNote {
  t: number;
  d: number;
  m: number;
  v: number;
}

export interface MelodyOptions {
  low: number;
  high: number;
  /** Where the first note gravitates to. */
  center: number;
  /** 0–1: chance of passing/neighbour notes on long notes. */
  ornament: number;
  /** 0–1: chance of dropping inner notes (sparser, for sleep). */
  rest: number;
}

/** A chord tone near `m` (≤ 2 semitones away when possible), preferring the smoother move from `prev`. */
function chordToneNear(m: number, prev: number, chord: Chord): number {
  if (isChordTone(m, chord)) return m;
  let best = snapToChord(m, chord);
  for (let d = -2; d <= 2; d++) {
    const n = m + d;
    if (isChordTone(n, chord) && Math.abs(n - prev) < Math.abs(best - prev)) best = n;
  }
  return best;
}

/**
 * Build a motif from a rhythm vocabulary and contour tendencies. Mostly steps and repeats
 * (predictable, low-surprise lines), and every leap is answered by a step back the other way.
 */
export function makeMotif(rng: Rng, rhythms: number[][], maxLeap = 3): Motif {
  const rhythm = rng.pick(rhythms);
  const steps: number[] = [];
  rhythm.forEach((_, i) => {
    const prev = steps[i - 1] ?? 0;
    if (i === 0) steps.push(0);
    else if (Math.abs(prev) >= 3) steps.push(-Math.sign(prev));
    else
      steps.push(
        rng.weighted([
          [1, 5], [-1, 5], [0, 1.5], [2, 1.2], [-2, 1.2], [maxLeap, 0.35], [-maxLeap, 0.3],
        ] as const),
      );
  });
  return { steps, rhythm };
}

/**
 * Turn a motif into a full phrase melody over the phrase's chords:
 * statement, answer (sequence or inversion), half cadence mid-phrase, full cadence at the end.
 */
export function generateMelody(ctx: PhraseContext, motif: Motif, rng: Rng, o: MelodyOptions): MelNote[] {
  const { meter, bars } = ctx;
  const total = bars * meter;
  const motifBeats = motif.rhythm.reduce((a, b) => a + b, 0);
  const unitBeats = Math.max(meter, Math.ceil(motifBeats / meter) * meter);
  const units = Math.max(1, Math.floor(total / unitBeats));
  const scale = scaleNotes(ctx.keyPc, ctx.recipe.scale, o.low - 12, o.high + 12);
  const half = total / 2;
  const strongEvery = meter === 3 ? 3 : 2;

  const nearestIndex = (m: number) => {
    let best = 0;
    for (let i = 1; i < scale.length; i++) if (Math.abs(scale[i] - m) < Math.abs(scale[best] - m)) best = i;
    return best;
  };
  const at = (m: number, steps: number) => scale[Math.min(scale.length - 1, Math.max(0, nearestIndex(m) + steps))];
  /** Move by scale steps, turning back rather than wrapping an octave when the line hits its range. */
  const move = (m: number, steps: number) => {
    const n = at(m, steps);
    return n > o.high || n < o.low ? at(m, -steps) : n;
  };
  const clamp = (m: number) => {
    while (m > o.high) m -= 12;
    while (m < o.low) m += 12;
    return m;
  };

  const notes: MelNote[] = [];
  let unitStart = clamp(snapToChord(o.center, ctx.chordAt(0)));

  for (let u = 0; u < units; u++) {
    const t0 = u * unitBeats;
    const endsHalf = units > 1 && t0 + unitBeats === half;
    const endsPhrase = u === units - 1;

    let invert = false;
    if (u > 0) {
      const develop = ctx.variation.develop || u % 2 === 1;
      const shape = develop ? rng.pick(['seqDown', 'seqUp', 'invert', 'plain'] as const) : 'plain';
      if (shape === 'seqDown') unitStart = move(unitStart, -1);
      else if (shape === 'seqUp') unitStart = move(unitStart, 2);
      else if (shape === 'invert') invert = true;
      unitStart = clamp(snapToChord(unitStart, ctx.chordAt(t0)));
    }

    let cur = unitStart;
    let t = t0;
    for (let k = 0; k < motif.rhythm.length && t < t0 + unitBeats; k++) {
      const prev = cur;
      if (k > 0) cur = move(cur, invert ? -motif.steps[k] : motif.steps[k]);
      // Strong beats land on a chord tone: of the two nearest, the one closer to the previous note.
      if (Math.abs(t % strongEvery) < 1e-6) cur = chordToneNear(cur, prev, ctx.chordAt(t));
      cur = clamp(cur);
      const isLast = k === motif.rhythm.length - 1 || t + motif.rhythm[k] >= t0 + unitBeats;
      const d = isLast ? t0 + unitBeats - t : motif.rhythm[k];
      if (isLast && endsPhrase) cur = clamp(nearestPitch(ctx.keyPc, cur));
      else if (isLast && endsHalf) cur = clamp(snapToChord(cur, ctx.chordAt(t)));
      notes.push({ t, d, m: cur, v: 0 });
      t += d;
    }
  }

  // Ornaments and rests, then a gentle dynamic arc across the phrase (about 3 dB, no accents).
  const out: MelNote[] = [];
  notes.forEach((n, i) => {
    const next = notes[i + 1];
    const inner = i > 0 && next && Math.abs(next.t % unitBeats) > 1e-6;
    if (inner && rng.chance(o.rest)) {
      if (out.length) out[out.length - 1].d += n.d;
      return;
    }
    if (next && n.d >= 1 && Math.abs(next.m - n.m) >= 3 && rng.chance(o.ornament)) {
      const passing = move(n.m, next.m > n.m ? 1 : -1);
      out.push({ ...n, d: n.d - 0.5 }, { t: n.t + n.d - 0.5, d: 0.5, m: passing, v: 0 });
      return;
    }
    out.push({ ...n });
  });

  for (const n of out) {
    const arc = Math.sin(Math.PI * Math.min(1, (n.t + 0.5) / total));
    const strong = Math.abs(n.t % meter) < 1e-6 ? 0.04 : 0;
    n.v = Math.min(1, 0.6 + 0.15 * arc + strong + rng.range(-0.03, 0.03));
  }
  return out;
}
