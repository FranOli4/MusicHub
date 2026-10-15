import type { Space } from '../../recipes/schema';
import type { Rng } from '../rng';
import { THEMES, type ThemeId } from '../themes';
import { mod12 } from '../theory';
import type { NoteEvent, PhraseContext, StyleDef } from '../types';
import { bassLine, buildRecipe, figure, MAJOR_KEYS, melody, sustain, tempoFor } from './common';

// Progressions common in contemporary worship: four-chord loops with sus/add9 colour.
const VERSES = [
  ['I', 'V', 'vi', 'IV'],
  ['I', 'Vsus4 V', 'vi', 'IV'],
  ['IVadd9', 'I/3', 'V', 'vi'],
  ['I', 'iii', 'IV', 'V'],
  ['vi', 'IV', 'I', 'V'],
  ['I', 'IVadd9', 'vi', 'Vsus4'],
  ['I', 'I/3', 'IV', 'IV'],
];
const CHORUSES = [
  ['IV', 'I', 'V', 'vi'],
  ['IV', 'V', 'iii', 'vi'],
  ['vi', 'V/3', 'IV', 'I/3'],
  ['IV', 'I/3', 'ii7', 'Vsus4'],
  ['IVadd9', 'V', 'vi7', 'I'],
];
const BRIDGES = [
  ['vi', 'V', 'IV', 'IV'],
  ['ii7', 'I/3', 'IV', 'Vsus4'],
  ['IV', 'IV', 'I/3', 'V'],
];

const ADJ = ['Still', 'Quiet', 'Morning', 'Evening', 'Gentle', 'Faithful', 'Abiding', 'Everlasting', 'Holy', 'Shepherd’s', 'Hidden', 'Living'];
const NOUN = ['Waters', 'Mercy', 'Grace', 'Light', 'Refuge', 'Psalm', 'Hymn', 'Dawn', 'Peace', 'Rest', 'Pastures', 'Sanctuary', 'Wings', 'Stream'];

function worshipRecipe(rng: Rng, space: Space, style: 'worship-piano' | 'worship-ambient') {
  const ambient = style === 'worship-ambient';
  const tempo = ambient
    ? tempoFor(rng, space, [58, 68], [40, 50])
    : tempoFor(rng, space, [66, 82], [50, 58]);
  const density = space === 'sleep' ? rng.range(0.2, 0.4) : rng.range(0.45, 0.75);
  const brightness = space === 'sleep' ? rng.range(0.15, 0.35) : rng.range(0.45, 0.7);
  const reverb = ambient || space === 'sleep' ? rng.range(0.6, 0.85) : rng.range(0.35, 0.55);
  const key = rng.pick(MAJOR_KEYS);

  if (rng.chance(ambient ? 0.15 : 0.3)) {
    const themeId: ThemeId = rng.pick(['amazing-grace', 'hymn-to-joy'] as const);
    const theme = THEMES[themeId];
    return buildRecipe({
      name: `${theme.title} (meditation)`,
      space, style, key, scale: 'major', tempo: Math.round(tempo * (theme.meter === 3 ? 1.1 : 1)),
      meter: theme.meter, sections: theme.sections, form: theme.form, theme: themeId,
      density, brightness, reverb,
    });
  }

  const meter = rng.chance(0.2) ? 3 : 4;
  const sections = [
    { name: 'A', progression: rng.pick(VERSES) },
    { name: 'B', progression: rng.pick(CHORUSES) },
  ];
  let form = rng.pick(['AB', 'AABB', 'ABAB']);
  if (rng.chance(0.4)) {
    sections.push({ name: 'C', progression: rng.pick(BRIDGES) });
    form = rng.pick(['ABABC', 'AABBCB']);
  }
  return buildRecipe({
    name: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`,
    space, style, key, scale: 'major', tempo, meter, sections, form,
    density, brightness, reverb,
  });
}

const rhythms4Think = [[1, 1, 2], [1.5, 0.5, 2], [2, 1, 1], [1, 1, 1, 1], [0.5, 0.5, 1, 2], [3, 1]];
const rhythms4Sleep = [[2, 2], [3, 1], [2, 1, 1], [4], [1.5, 0.5, 2]];
const rhythms3 = [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [3], [1, 2]];

export const worshipPiano: StyleDef = {
  id: 'worship-piano',
  label: 'Worship piano',
  family: 'worship',
  blurb: 'Felt piano over warm pads, gentle worship chord loops',
  spaces: ['think', 'sleep'],
  instruments: ['piano', 'pad', 'strings'],
  newRecipe: (rng, space) => worshipRecipe(rng, space, 'worship-piano'),
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const { density } = ctx.variation;
    const sleep = ctx.recipe.space === 'sleep';
    const out: NoteEvent[] = [];
    if (ctx.has('pad')) out.push(...sustain(ctx, 'pad', 60, 0.32));
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 67, 0.2, 3));
    if (ctx.has('piano')) {
      out.push(...bassLine(ctx, 'piano', { low: 36, step: density > 0.6 && !sleep ? ctx.meter / 2 : 0, v: 0.45, octaves: true }));
      const step = density > 0.55 ? 0.5 : density > 0.3 ? 1 : ctx.meter;
      out.push(...figure(ctx, 'piano', { pattern: [0, 2, 1, 3, 2, 1], step, floor: 53, span: 4, v: 0.28, gate: 1.6 }));
      out.push(
        ...melody(ctx, 'piano', {
          low: 64, high: 81, center: 72, v: 0.85,
          ornament: sleep ? 0 : 0.25, rest: sleep ? 0.25 : 0.05,
          rhythms3, rhythms4: sleep ? rhythms4Sleep : rhythms4Think,
        }),
      );
    }
    return out;
  },
};

export const worshipAmbient: StyleDef = {
  id: 'worship-ambient',
  label: 'Worship ambient',
  family: 'worship',
  blurb: 'Slow swelling pads with sparse piano — prayerful and spacious',
  spaces: ['sleep', 'think'],
  instruments: ['pad', 'piano', 'cello', 'strings'],
  newRecipe: (rng, space) => worshipRecipe(rng, space, 'worship-ambient'),
  renderPhrase(ctx: PhraseContext): NoteEvent[] {
    const { density } = ctx.variation;
    const out: NoteEvent[] = [];
    if (ctx.has('pad')) {
      out.push(...sustain(ctx, 'pad', 57, 0.38));
      if (density > 0.35) out.push(...sustain(ctx, 'pad', 76, 0.12, 3));
    }
    if (ctx.has('cello')) out.push(...bassLine(ctx, 'cello', { low: 36, step: 0, v: 0.3 }));
    if (ctx.has('strings')) out.push(...sustain(ctx, 'strings', 65, 0.16, 3));
    if (ctx.has('piano')) {
      out.push(
        ...melody(ctx, 'piano', {
          low: 62, high: 79, center: 72, v: 0.6,
          ornament: 0, rest: 0.4,
          rhythms3: [[3], [2, 1], [3, 3]],
          rhythms4: [[4, 4], [3, 5], [6, 2], [2, 6], [4]],
        }),
      );
      // Occasional rolled chord low in the piano.
      for (const { chord, at } of ctx.chords) {
        if (!ctx.rng.chance(density * 0.6)) continue;
        const notes = chord.pcs.slice(0, 3).map((pc) => 48 + mod12(pc - 48));
        notes.sort((a, b) => a - b).forEach((m, k) => out.push({ t: at + k * 0.25, d: ctx.meter * 1.5, m, v: 0.22, i: 'piano' }));
      }
    }
    return out;
  },
};
