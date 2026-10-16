import type { Space } from '../../recipes/schema';
import { Rng } from '../rng';
import type { NoteEvent, PhraseContext, StyleDef } from '../types';
import { bassLine, buildRecipe, figure, keyName, MAJOR_KEYS, melody, MINOR_KEYS, repeatedChords, sustain, tempoFor } from './common';

// More classical composers, so "Classical" isn't only Mozart and Vivaldi. All of them follow
// docs/music-and-concentration.md: moderate tempos, major-leaning, stepwise legato tunes, a
// sustained bed, and fewer accompaniment onsets for deep focus and sleep.

const sleepOf = (ctx: PhraseContext) => ctx.recipe.space === 'sleep';
const moods = (rng: Rng, space: Space) => ({
  density: space === 'sleep' ? rng.range(0.2, 0.35) : rng.range(0.45, 0.75),
  brightness: space === 'sleep' ? rng.range(0.15, 0.3) : rng.range(0.45, 0.7),
  reverb: space === 'sleep' ? rng.range(0.6, 0.8) : rng.range(0.35, 0.5),
});

// ---------------- Bach: keyboard prelude / aria (think the C-major Prelude, the Goldberg Aria) ----------------

const BACH_MAJOR_A = [
  ['I', 'ii7/7', 'V7/3', 'I', 'vi/3', 'II7/7', 'V/3', 'Imaj7/7'], // descending bass over a tonic pedal
  ['I', 'V/3', 'vi', 'iii/3', 'IV', 'I/3', 'ii7', 'V7'],
  ['I', 'IV/3', 'viio/3', 'I', 'IV', 'ii7', 'V7', 'I'],
  ['I', 'vi', 'ii7', 'V7', 'iii', 'vi', 'ii7 V7', 'I'], // circle-of-fifths sequence
];
const BACH_MAJOR_B = [
  ['IV', 'viio/3', 'iii', 'vi', 'ii', 'V7', 'I', 'I'],
  ['V/3', 'vi', 'iii/3', 'IV', 'ii7/7', 'V7/3', 'Vsus4 V7', 'I'],
  ['ii7', 'V7', 'Imaj7', 'IVmaj7', 'viio', 'iii', 'vi', 'ii V7'],
];
const BACH_MINOR_A = [
  ['i', 'iv/3', 'V7/3', 'i', 'VI', 'iio/3', 'V7', 'i'],
  ['i', 'iv', 'VII', 'III', 'VI', 'iio', 'V', 'i'],
];
const BACH_MINOR_B = [
  ['III', 'VI', 'iio', 'V', 'i', 'iv', 'V7', 'i'],
  ['iv', 'i/3', 'iio', 'V', 'VI', 'iv', 'Vsus4 V', 'i'],
];

function bachRecipe(rng: Rng, space: Space) {
  const minor = rng.chance(space === 'think' ? 0.2 : 0.3);
  const scale = minor ? ('minor' as const) : ('major' as const);
  const meter = (rng.chance(0.25) ? 3 : 4) as 3 | 4;
  const recipe = {
    space, style: 'bach' as const, scale, meter,
    key: minor ? rng.pick(MINOR_KEYS) : rng.pick(MAJOR_KEYS),
    tempo: tempoFor(rng, space, [66, 88], [44, 54]),
    sections: [
      { name: 'A', progression: rng.pick(minor ? BACH_MINOR_A : BACH_MAJOR_A) },
      { name: 'B', progression: rng.pick(minor ? BACH_MINOR_B : BACH_MAJOR_B) },
    ],
    form: rng.pick(['AB', 'AABB', 'ABA']),
    ...moods(rng, space),
  };
  const kind = meter === 3 ? rng.pick(['Aria', 'Sarabande']) : space === 'sleep' ? 'Aria' : rng.pick(['Prelude', 'Sinfonia', 'Arioso']);
  return buildRecipe({ ...recipe, name: `${kind} in ${keyName(recipe)}` });
}

/** Even broken-chord figures in the manner of the Well-Tempered Clavier preludes. */
const BACH_FIGURES = [[0, 1, 2, 3, 4, 2, 3, 4], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 3, 2, 1, 2, 3]];

export const bach: StyleDef = {
  id: 'bach',
  label: 'Bach',
  family: 'classical',
  blurb: 'Keyboard prelude and aria: a calm tune over an even, flowing broken-chord figure',
  spaces: ['think', 'sleep'],
  instruments: ['piano', 'cello', 'strings'],
  bed: 'strings',
  newRecipe: bachRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const sleep = sleepOf(ctx);
    const { focus } = ctx.variation;
    const out: NoteEvent[] = [];
    if (ctx.has('piano')) {
      out.push(
        ...melody(ctx, 'piano', {
          low: 67, high: 86, center: 76, v: sleep ? 0.8 : 0.72, maxLeap: 3,
          ornament: sleep ? 0 : 0.25, rest: 0,
          rhythms3: sleep ? [[3], [2, 1]] : [[1, 1, 1], [2, 1], [1.5, 0.5, 1]],
          rhythms4: sleep ? [[2, 2], [3, 1], [4], [2, 1, 1]] : [[1, 1, 2], [0.5, 0.5, 1, 2], [1.5, 0.5, 1, 1], [1, 1, 1, 1], [2, 1, 1]],
        }),
      );
      // One figure per section for the whole song: a steady pattern, not a changing one.
      const pattern = Rng.from(ctx.seed, 'figure', ctx.section).pick(BACH_FIGURES);
      const step = sleep || focus === 'deep' ? 1 : 0.5;
      out.push(...figure(ctx, 'piano', { pattern, step, floor: 48, span: 5, v: 0.24, gate: 1.6 }));
    }
    if (ctx.has('cello')) out.push(...bassLine(ctx, 'cello', { low: 36, step: 0, v: 0.3 }));
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 60, sleep ? 0.14 : 0.1, 3));
    return out;
  },
};

// ---------------- Handel: stately air and largo (think the Water Music air, "Ombra mai fu") ----------------

const HANDEL_MAJOR_A = [
  ['I', 'IV', 'V7', 'I', 'vi', 'ii', 'Vsus4 V', 'I'],
  ['I', 'V/3', 'vi', 'IV', 'I/3', 'ii', 'V7', 'I'],
  ['I', 'I', 'IV', 'I/3', 'ii', 'V', 'Vsus4 V7', 'I'],
];
const HANDEL_MAJOR_B = [
  ['IV', 'I/3', 'ii', 'V', 'iii', 'vi', 'ii7 V7', 'I'],
  ['V', 'I', 'ii', 'V', 'vi', 'iii', 'IV', 'Vsus4 V'],
  ['vi', 'iii', 'IV', 'I', 'ii', 'I/5', 'Vsus4 V7', 'I'],
];
const HANDEL_MINOR_A = [
  ['i', 'iv', 'V', 'i', 'VI', 'iv', 'Vsus4 V', 'i'],
  ['i', 'V/3', 'i', 'iv/3', 'V', 'VI', 'iio V', 'i'],
];
const HANDEL_MINOR_B = [
  ['III', 'VII', 'i', 'V', 'VI', 'iv', 'Vsus4 V', 'V'],
  ['iv', 'i', 'VI', 'III', 'iv', 'iio', 'V7', 'i'],
];

function handelRecipe(rng: Rng, space: Space) {
  const minor = rng.chance(0.25);
  const scale = minor ? ('minor' as const) : ('major' as const);
  const meter = (rng.chance(0.3) ? 3 : 4) as 3 | 4;
  const recipe = {
    space, style: 'handel' as const, scale, meter,
    key: minor ? rng.pick(MINOR_KEYS) : rng.pick(['C', 'D', 'F', 'G', 'A', 'Bb'] as const),
    tempo: tempoFor(rng, space, [64, 84], [42, 52]),
    sections: [
      { name: 'A', progression: rng.pick(minor ? HANDEL_MINOR_A : HANDEL_MAJOR_A) },
      { name: 'B', progression: rng.pick(minor ? HANDEL_MINOR_B : HANDEL_MAJOR_B) },
    ],
    form: rng.pick(['AABA', 'ABA', 'AABB']),
    ...moods(rng, space),
  };
  const kind = meter === 3 ? 'Sarabande' : space === 'sleep' ? 'Largo' : rng.pick(['Air', 'Andante', 'Larghetto']);
  return buildRecipe({ ...recipe, name: `${kind} in ${keyName(recipe)}` });
}

export const handel: StyleDef = {
  id: 'handel',
  label: 'Handel',
  family: 'classical',
  blurb: 'Stately Baroque air: cantabile violin over a gentle continuo and soft organ',
  spaces: ['think', 'sleep'],
  instruments: ['violin', 'strings', 'organ', 'bass', 'cello'],
  bed: 'strings',
  newRecipe: handelRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const sleep = sleepOf(ctx);
    const { focus, develop } = ctx.variation;
    const out: NoteEvent[] = [];
    const tune = ctx.has('violin')
      ? melody(ctx, 'violin', {
          low: 67, high: 86, center: 75, v: sleep ? 0.8 : 0.75, maxLeap: 4,
          ornament: sleep ? 0.1 : 0.3, rest: 0,
          rhythms3: sleep ? [[3], [2, 1]] : [[2, 1], [1.5, 0.5, 1], [3], [1, 1, 1]],
          rhythms4: sleep ? [[2, 2], [3, 1], [4]] : [[2, 1, 1], [1.5, 0.5, 2], [1, 1, 2], [3, 1], [1, 0.5, 0.5, 2]],
        })
      : [];
    out.push(...tune);
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 64, sleep ? 0.14 : 0.11, 3));
    if (ctx.has('organ')) out.push(...sustain(ctx, 'organ', 55, sleep ? 0.1 : 0.12, 3));
    if (ctx.has('bass')) {
      // Continuo bass walks in quarters (halves for deep focus), held in Sleep.
      const step = sleep ? 0 : focus === 'deep' ? 2 : 1;
      out.push(...bassLine(ctx, 'bass', { low: 36, step, v: 0.42, gate: 0.92, octaves: step === 1 }));
    }
    // Cello doubles the tune an octave below on development passes.
    if (ctx.has('cello') && develop) out.push(...tune.map((n) => ({ ...n, m: n.m - 12, v: n.v * 0.5, i: 'cello' as const })));
    return out;
  },
};

// ---------------- Haydn: string-quartet andante ----------------

const HAYDN_A = [
  ['I', 'ii7', 'V7', 'I', 'I', 'IV', 'I/5 V7', 'I'],
  ['I', 'V7/5', 'I/3', 'IV', 'ii', 'I/5', 'V7', 'I'],
  ['I', 'vi', 'IV', 'V', 'I', 'ii', 'V7', 'I'],
  ['I', 'I', 'V7', 'V7', 'V7', 'V7', 'I', 'I'],
];
const HAYDN_B = [
  ['V', 'V7', 'I', 'I', 'IV', 'ii', 'I/5 V7', 'I'],
  ['IV', 'iv', 'I/5', 'V7', 'vi', 'ii', 'V7', 'I'], // borrowed minor iv for a moment of shade
  ['vi', 'iii', 'IV', 'I', 'ii', 'iv', 'I/5 V7', 'I'],
];

function haydnRecipe(rng: Rng, space: Space) {
  const meter = (rng.chance(0.3) ? 3 : 4) as 3 | 4;
  const recipe = {
    space, style: 'haydn' as const, scale: 'major' as const, meter,
    key: rng.pick(['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'] as const),
    tempo: tempoFor(rng, space, meter === 3 ? [80, 100] : [72, 96], [44, 54]),
    sections: [
      { name: 'A', progression: rng.pick(HAYDN_A) },
      { name: 'B', progression: rng.pick(HAYDN_B) },
    ],
    form: rng.pick(['AABA', 'ABA', 'AABB']),
    ...moods(rng, space),
  };
  const movement = space === 'sleep' ? 'Adagio' : meter === 3 ? 'Menuetto' : rng.pick(['Andante', 'Poco adagio', 'Andante cantabile']);
  return buildRecipe({ ...recipe, name: `Quartet in ${keyName(recipe)} — ${movement}` });
}

export const haydn: StyleDef = {
  id: 'haydn',
  label: 'Haydn',
  family: 'classical',
  blurb: 'String-quartet andante: first violin over warm, legato inner voices and cello',
  spaces: ['think', 'sleep'],
  instruments: ['violin', 'strings', 'cello'],
  bed: 'strings',
  newRecipe: haydnRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const sleep = sleepOf(ctx);
    const { focus } = ctx.variation;
    const slow = sleep || focus === 'deep';
    const out: NoteEvent[] = [];
    if (ctx.has('violin')) {
      out.push(
        ...melody(ctx, 'violin', {
          low: 67, high: 86, center: 76, v: sleep ? 0.8 : 0.72, maxLeap: 4,
          ornament: sleep ? 0.05 : 0.2, rest: 0,
          rhythms3: sleep ? [[3], [2, 1]] : [[1, 1, 1], [2, 1], [1.5, 0.5, 1]],
          rhythms4: sleep ? [[2, 2], [2, 1, 1], [3, 1], [4]] : [[1, 1, 1, 1], [1, 0.5, 0.5, 2], [2, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 2]],
        }),
      );
    }
    if (ctx.has('strings')) {
      // Second violin and viola: quiet legato chords on the beat, or one per half bar when calm.
      const step = slow ? (ctx.meter === 3 ? 3 : 2) : 1;
      out.push(...repeatedChords(ctx, 'strings', { step, floor: 55, count: 2, v: sleep ? 0.18 : 0.2, gate: 0.97 }));
      out.push(...sustain(ctx, 'strings', 60, 0.08, 2));
    }
    if (ctx.has('cello')) out.push(...bassLine(ctx, 'cello', { low: 36, step: sleep ? 0 : slow ? 2 : 1, v: sleep ? 0.25 : 0.4, gate: 0.92 }));
    return out;
  },
};

// ---------------- Schubert: piano impromptu ----------------

const SCHUBERT_A = [
  ['I', 'vi', 'IV', 'V7', 'I', 'iii', 'IV', 'V'],
  ['I', 'I', 'V7', 'V7', 'vi', 'iii', 'IV I/3', 'ii V7'],
  ['I', 'bVI', 'IV', 'V7', 'I', 'vi', 'ii7', 'V7'], // the flattened sixth Schubert loved
];
const SCHUBERT_B = [
  ['vi', 'iii', 'IV', 'I', 'bVI', 'IV', 'V', 'V7'],
  ['iv', 'I', 'bVI', 'V', 'I/3', 'IV', 'ii V7', 'I'],
  ['IV', 'I/3', 'ii', 'V', 'iii', 'vi', 'ii7 V7', 'I'],
];

function schubertRecipe(rng: Rng, space: Space) {
  const meter = (rng.chance(0.2) ? 3 : 4) as 3 | 4;
  const recipe = {
    space, style: 'schubert' as const, scale: 'major' as const, meter,
    key: rng.pick(['C', 'Db', 'Eb', 'F', 'Gb', 'G', 'Ab', 'Bb'] as const),
    tempo: tempoFor(rng, space, [58, 72], [42, 52]),
    sections: [
      { name: 'A', progression: rng.pick(SCHUBERT_A) },
      { name: 'B', progression: rng.pick(SCHUBERT_B) },
    ],
    form: rng.pick(['AB', 'AABA', 'ABA']),
    ...moods(rng, space),
  };
  const kind = rng.pick(space === 'sleep' ? ['Andante', 'Nocturne'] : ['Impromptu', 'Moment musical', 'Andante']);
  return buildRecipe({ ...recipe, name: `${kind} in ${keyName(recipe)}` });
}

export const schubert: StyleDef = {
  id: 'schubert',
  label: 'Schubert',
  family: 'classical',
  blurb: 'Piano impromptu: a singing tune over a flowing triplet accompaniment',
  spaces: ['think', 'sleep'],
  instruments: ['piano', 'strings', 'cello'],
  bed: 'strings',
  newRecipe: schubertRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const sleep = sleepOf(ctx);
    const { focus, density } = ctx.variation;
    const out: NoteEvent[] = [];
    if (ctx.has('piano')) {
      // Tune rhythms stay on the beat so they line up with the triplets (no extra onsets).
      out.push(
        ...melody(ctx, 'piano', {
          low: 67, high: 86, center: 76, v: sleep ? 0.8 : 0.75, maxLeap: 4,
          ornament: sleep ? 0 : 0.15, rest: 0,
          rhythms3: sleep ? [[3], [2, 1]] : [[1, 1, 1], [2, 1], [3]],
          rhythms4: sleep ? [[2, 2], [4], [3, 1]] : [[1, 1, 2], [2, 1, 1], [3, 1], [1, 1, 1, 1], [2, 2]],
        }),
      );
      const step = sleep ? 2 : focus === 'deep' ? 1 : 1 / 3;
      out.push(...figure(ctx, 'piano', { pattern: [0, 1, 2, 3, 2, 1], step, floor: 48, span: 4, v: 0.23, gate: 1.5 }));
      out.push(...bassLine(ctx, 'piano', { low: 36, step: 0, v: 0.36 }));
    }
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 62, sleep ? 0.14 : 0.1, 3));
    if (ctx.has('cello') && density > 0.4) out.push(...bassLine(ctx, 'cello', { low: 43, step: 0, v: 0.2 }));
    return out;
  },
};
