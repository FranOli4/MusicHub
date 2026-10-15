import type { Space } from '../../recipes/schema';
import type { Rng } from '../rng';
import { THEMES } from '../themes';
import type { NoteEvent, PhraseContext, StyleDef } from '../types';
import { bassLine, buildRecipe, figure, keyName, MAJOR_KEYS, melody, MINOR_KEYS, repeatedChords, sustain, tempoFor } from './common';

// ---------------- Mozart: Classical-era serenade (think "Eine kleine Nachtmusik") ----------------

/** 8-bar periods: antecedent ends on V (half cadence), consequent on I. */
const MOZART_A = [
  ['I', 'IV', 'V', 'V', 'I', 'IV', 'V7', 'I'],
  ['I', 'I', 'V7', 'V7', 'V7', 'V7', 'I', 'I'],
  ['I', 'ii', 'V7', 'I', 'I', 'IV', 'V7', 'I'],
  ['I', 'V/3', 'I', 'V', 'I', 'vi', 'ii V7', 'I'],
];
const MOZART_B = [
  ['V', 'V7', 'I', 'I', 'vi', 'ii', 'V7', 'I'],
  ['ii', 'V7', 'I', 'vi', 'IV', 'V7', 'I', 'V'],
  ['I', 'vi', 'ii', 'V', 'I', 'vi', 'ii V7', 'I'],
  ['IV', 'I/3', 'ii', 'V', 'IV', 'I/3', 'V7', 'I'],
];

function mozartRecipe(rng: Rng, space: Space) {
  const quote = space === 'think' && rng.chance(0.3);
  const meter = !quote && rng.chance(0.25) ? 3 : 4; // occasionally a minuet
  const key = quote ? 'G' : rng.pick(['G', 'D', 'C', 'F', 'Bb', 'A'] as const);
  const base = {
    space, style: 'mozart' as const, key, scale: 'major' as const, meter: meter as 3 | 4,
    tempo: tempoFor(rng, space, meter === 3 ? [100, 120] : [96, 120], [50, 58]),
    density: space === 'sleep' ? rng.range(0.25, 0.4) : rng.range(0.5, 0.8),
    brightness: space === 'sleep' ? rng.range(0.2, 0.35) : rng.range(0.55, 0.75),
    reverb: space === 'sleep' ? rng.range(0.55, 0.75) : rng.range(0.3, 0.45),
  };
  const kind = meter === 3 ? 'Minuet' : space === 'sleep' ? 'Romanze' : rng.pick(['Serenade', 'Divertimento', 'Cassation']);
  if (quote) {
    const t = THEMES['eine-kleine'];
    return buildRecipe({ ...base, name: `Serenade in G major (after Mozart)`, sections: t.sections, form: t.form, theme: 'eine-kleine' });
  }
  return buildRecipe({
    ...base,
    name: `${kind} No. ${rng.int(2, 19)} in ${keyName(base)}`,
    sections: [
      { name: 'A', progression: rng.pick(MOZART_A) },
      { name: 'B', progression: rng.pick(MOZART_B) },
    ],
    form: rng.pick(['AABA', 'ABA', 'AAB']),
  });
}

export const mozart: StyleDef = {
  id: 'mozart',
  label: 'Mozart',
  family: 'classical',
  blurb: 'Bright string serenade: singing violin over Alberti and repeated-note accompaniment',
  spaces: ['think'],
  instruments: ['violin', 'strings', 'bass', 'cello'],
  newRecipe: mozartRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const { density, develop } = ctx.variation;
    const sleep = ctx.recipe.space === 'sleep';
    const out: NoteEvent[] = [];
    const tune = ctx.has('violin')
      ? melody(ctx, 'violin', {
          low: 67, high: 88, center: 76, v: 0.85, maxLeap: 4,
          ornament: sleep ? 0.1 : 0.35, rest: 0,
          rhythms3: [[1, 1, 1], [2, 0.5, 0.5], [1.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 1]],
          rhythms4: sleep
            ? [[2, 1, 1], [3, 1], [1.5, 0.5, 2]]
            : [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [1, 1, 1, 1], [1.5, 0.5, 1, 1], [0.25, 0.25, 0.5, 1, 2]],
        })
      : [];
    out.push(...tune);
    if (ctx.has('strings')) {
      out.push(
        ...(density >= 0.55 && !sleep
          ? figure(ctx, 'strings', { pattern: [0, 2, 1, 2], step: 0.5, floor: 55, span: 3, v: 0.3, gate: 0.85 })
          : repeatedChords(ctx, 'strings', { step: sleep ? 1 : 0.5, floor: 55, count: 3, v: 0.26, gate: sleep ? 0.9 : 0.5 })),
      );
    }
    if (ctx.has('bass')) out.push(...bassLine(ctx, 'bass', { low: 36, step: sleep ? 0 : 1, v: 0.5, gate: sleep ? 0.95 : 0.6, octaves: !sleep && density > 0.65 }));
    // Cello doubles the tune an octave and a sixth below on development passes.
    if (ctx.has('cello') && develop) out.push(...tune.map((n) => ({ ...n, m: n.m - 15, v: n.v * 0.55, i: 'cello' as const })));
    return out;
  },
};

// ---------------- Vivaldi: Baroque concerto (think "The Four Seasons") ----------------

const VIVALDI_MINOR_RITORNELLO = [
  ['i', 'i', 'iv', 'V', 'i', 'VI', 'iv V', 'i'],
  ['i', 'V', 'i', 'V', 'iv', 'i', 'V', 'i'],
  ['i', 'iv', 'V', 'i', 'VI', 'iio', 'V', 'i'],
];
/** Circle-of-fifths sequences, the engine of Vivaldi's solo episodes. */
const VIVALDI_MINOR_EPISODE = [
  ['i', 'iv', 'VII', 'III', 'VI', 'iio', 'V', 'i'],
  ['III', 'VI', 'iio', 'V', 'i', 'iv', 'V', 'i'],
  ['iv', 'VII', 'III', 'VI', 'iv', 'V', 'i', 'V'],
];
const VIVALDI_MAJOR_RITORNELLO = [
  ['I', 'I', 'V', 'I', 'IV', 'I', 'V', 'I'],
  ['I', 'IV', 'V', 'I', 'vi', 'IV', 'V', 'I'],
];
const VIVALDI_MAJOR_EPISODE = [
  ['I', 'IV', 'viio', 'iii', 'vi', 'ii', 'V', 'I'],
  ['vi', 'ii', 'V', 'I', 'IV', 'viio', 'V', 'I'],
];
const NICKNAMES = ['Winter Light', 'Autumn Rain', 'Summer Storm', 'Spring Morning', 'The Night', 'Sea Breeze', 'Harvest', 'Snowfall', 'Birdsong'];

function vivaldiRecipe(rng: Rng, space: Space) {
  const minor = rng.chance(0.6);
  const scale = minor ? ('minor' as const) : ('major' as const);
  const key = minor ? rng.pick(MINOR_KEYS) : rng.pick(['C', 'D', 'E', 'F', 'G', 'A'] as const);
  const sections = [
    { name: 'A', progression: rng.pick(minor ? VIVALDI_MINOR_RITORNELLO : VIVALDI_MAJOR_RITORNELLO) },
    { name: 'B', progression: rng.pick(minor ? VIVALDI_MINOR_EPISODE : VIVALDI_MAJOR_EPISODE) },
    { name: 'C', progression: rng.pick(minor ? VIVALDI_MINOR_EPISODE : VIVALDI_MAJOR_EPISODE) },
  ];
  const recipe = {
    space, style: 'vivaldi' as const, key, scale, meter: 4 as const,
    tempo: tempoFor(rng, space, [92, 112], [46, 54]),
    sections, form: 'ABACA',
    density: space === 'sleep' ? rng.range(0.2, 0.35) : rng.range(0.55, 0.85),
    brightness: space === 'sleep' ? rng.range(0.2, 0.35) : rng.range(0.5, 0.75),
    reverb: space === 'sleep' ? rng.range(0.55, 0.75) : rng.range(0.3, 0.45),
  };
  const movement = space === 'sleep' ? 'Largo' : 'Allegro';
  return buildRecipe({ ...recipe, name: `Concerto in ${keyName(recipe)} “${rng.pick(NICKNAMES)}” — ${movement}` });
}

export const vivaldi: StyleDef = {
  id: 'vivaldi',
  label: 'Vivaldi',
  family: 'classical',
  blurb: 'Baroque concerto: driving strings and harpsichord, solo-violin episodes',
  spaces: ['think'],
  instruments: ['violin', 'harpsichord', 'bass', 'strings', 'cello'],
  newRecipe: vivaldiRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const sleep = ctx.recipe.space === 'sleep';
    const ritornello = ctx.section === 'A';
    const out: NoteEvent[] = [];

    if (ctx.has('violin')) {
      if (ritornello || sleep) {
        const tune = melody(ctx, 'violin', {
          low: 67, high: 88, center: 76, v: ritornello ? 0.9 : 0.75, maxLeap: 4,
          ornament: 0.2, rest: 0,
          rhythms3: [[1, 1, 1], [0.5, 0.5, 1, 1]],
          rhythms4: sleep
            ? [[2, 2], [3, 1], [1.5, 0.5, 2]]
            : [[0.5, 0.5, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.25, 0.25, 0.25, 0.25, 1, 2]],
        });
        out.push(...tune);
        // Tutti: the section doubles the tune an octave below.
        if (ritornello && ctx.has('strings') && !sleep) out.push(...tune.map((n) => ({ ...n, m: n.m - 12, v: n.v * 0.45, i: 'strings' as const })));
      } else {
        // Solo episode: running arpeggio figuration.
        const pattern = ctx.rng.pick([[0, 1, 2, 3], [0, 2, 1, 3], [3, 2, 1, 0], [0, 1, 2, 1], [0, 2, 4, 2]]);
        out.push(...figure(ctx, 'violin', { pattern, step: 0.25, floor: 67, span: 5, v: 0.6, gate: 0.9 }));
      }
    }
    if (ctx.has('harpsichord')) {
      out.push(...repeatedChords(ctx, 'harpsichord', { step: sleep ? 2 : 1, floor: 52, count: 4, v: ritornello ? 0.42 : 0.32, gate: 0.4 }));
    }
    if (ctx.has('bass')) {
      out.push(...bassLine(ctx, 'bass', { low: 36, step: sleep ? 1 : 0.5, v: ritornello ? 0.55 : 0.4, gate: sleep ? 0.35 : 0.7, octaves: ritornello && !sleep }));
    }
    if (ctx.has('cello') && !ritornello) out.push(...bassLine(ctx, 'cello', { low: 43, step: 2, v: 0.3, gate: 0.9 }));
    if (ctx.has('strings') && (sleep || !ritornello)) out.push(...sustain(ctx, 'strings', 62, sleep ? 0.18 : 0.14, 3));
    return out;
  },
};

// ---------------- Adagio: slow movements (Romanze, Largo) ----------------

const ADAGIO_MAJOR = [
  ['I', 'vi', 'IV', 'V', 'I', 'IV', 'V7', 'I'],
  ['I', 'V/3', 'vi', 'iii/3', 'IV', 'I/3', 'ii', 'V'], // ground bass in the manner of Pachelbel
  ['I', 'IV', 'I', 'V7', 'I', 'ii', 'V7', 'I'],
  ['I', 'iii', 'vi', 'IV', 'ii', 'V', 'Vsus4 V', 'I'],
];
const ADAGIO_MAJOR_B = [
  ['vi', 'ii', 'V', 'I', 'IV', 'ii', 'V', 'V7'],
  ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'I', 'I'],
];
const ADAGIO_MINOR = [
  ['i', 'iv', 'V', 'i', 'VI', 'iv', 'V', 'i'],
  ['i', 'VI', 'III', 'VII', 'iv', 'i', 'V', 'i'],
];
const ADAGIO_MINOR_B = [
  ['III', 'VII', 'i', 'V', 'VI', 'iv', 'V', 'V'],
  ['iv', 'i', 'VI', 'V', 'i', 'iv', 'V', 'i'],
];

function adagioRecipe(rng: Rng, space: Space) {
  const minor = rng.chance(0.3);
  const scale = minor ? ('minor' as const) : ('major' as const);
  const key = minor ? rng.pick(MINOR_KEYS) : rng.pick(MAJOR_KEYS);
  const recipe = {
    space, style: 'adagio' as const, key, scale, meter: (rng.chance(0.3) ? 3 : 4) as 3 | 4,
    tempo: tempoFor(rng, space, [60, 72], [42, 52]),
    sections: [
      { name: 'A', progression: rng.pick(minor ? ADAGIO_MINOR : ADAGIO_MAJOR) },
      { name: 'B', progression: rng.pick(minor ? ADAGIO_MINOR_B : ADAGIO_MAJOR_B) },
    ],
    form: rng.pick(['AB', 'AAB', 'ABA']),
    density: space === 'sleep' ? rng.range(0.15, 0.35) : rng.range(0.35, 0.55),
    brightness: space === 'sleep' ? rng.range(0.15, 0.3) : rng.range(0.35, 0.55),
    reverb: rng.range(0.6, 0.85),
  };
  const kind = rng.pick(['Romanze', 'Largo', 'Adagio', 'Andante cantabile', 'Air']);
  return buildRecipe({ ...recipe, name: `${kind} in ${keyName(recipe)}` });
}

export const adagio: StyleDef = {
  id: 'adagio',
  label: 'Slow movement',
  family: 'classical',
  blurb: 'Romanze and Largo: cantabile violin over pizzicato and muted strings',
  spaces: ['sleep', 'think'],
  instruments: ['violin', 'pizz', 'strings', 'cello'],
  newRecipe: adagioRecipe,
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const { density } = ctx.variation;
    const out: NoteEvent[] = [];
    if (ctx.has('violin')) {
      out.push(
        ...melody(ctx, 'violin', {
          low: 65, high: 84, center: 74, v: 0.7, maxLeap: 3,
          ornament: 0.25, rest: 0.1,
          rhythms3: [[2, 1], [3], [1.5, 0.5, 1], [3, 2, 1]],
          rhythms4: [[2, 1, 1], [3, 1], [2, 2], [1.5, 0.5, 2], [4]],
        }),
      );
    }
    if (ctx.has('pizz')) {
      out.push(...bassLine(ctx, 'pizz', { low: 36, step: ctx.meter, v: 0.4, gate: 0.5 }));
      const step = density > 0.3 ? 1 : 2;
      out.push(...figure(ctx, 'pizz', { pattern: [1, 2, 3, 2], step, floor: 50, span: 4, v: 0.26, gate: 0.4 }));
    }
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 62, 0.17, 3));
    if (ctx.has('cello')) out.push(...bassLine(ctx, 'cello', { low: 43, step: 0, v: 0.22 }));
    return out;
  },
};
