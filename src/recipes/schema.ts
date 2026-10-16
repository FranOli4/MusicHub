import { z } from 'zod';
import { THEME_IDS } from '../engine/themes';

export const SPACES = ['think', 'sleep'] as const;
export type Space = (typeof SPACES)[number];

export const STYLE_IDS = ['worship-piano', 'worship-ambient', 'mozart', 'vivaldi', 'bach', 'handel', 'haydn', 'schubert', 'adagio'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export const INSTRUMENT_IDS = [
  'piano',
  'pad',
  'strings', // sustained string section
  'violin', // solo / first violin line
  'cello',
  'bass', // contrabass / cello-bass line
  'pizz', // pizzicato strings
  'harpsichord',
  'harp',
  'organ',
] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

export const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Roman-numeral chord, e.g. "I", "vi", "V7", "IVadd9", "Vsus4", "I/3", "bVII", "#viio". */
export const CHORD_PATTERN = /^[b#]?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(o|ø|\+)?(maj7|7|add9|9|sus2|sus4)?(\/[1-7])?$/;

export const sectionSchema = z.object({
  name: z.string().regex(/^[A-Z]$/, 'Section names are single capital letters: A, B, C…'),
  /** One entry per bar: one chord ("I") or two chords sharing the bar ("IV V"). */
  progression: z.array(z.string().trim().min(1)).min(1).max(16),
});

export const motifSchema = z.object({
  /** Scale-step movement for each note (0 = repeat, 1 = step up, -2 = skip down…). */
  steps: z.array(z.number().int().min(-7).max(7)).min(2).max(16),
  /** Duration of each note in beats (quarter notes). Same length as steps. */
  rhythm: z.array(z.number().min(0.25).max(8)).min(2).max(16),
});

export const recipeSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1).max(60),
    space: z.enum(SPACES),
    style: z.enum(STYLE_IDS),
    key: z.enum(KEYS),
    scale: z.enum(['major', 'minor']),
    tempo: z.number().min(30).max(160),
    meter: z.union([z.literal(3), z.literal(4)]),
    sections: z.array(sectionSchema).min(1).max(6),
    form: z.string().regex(/^[A-Z]{1,12}$/).optional(),
    instruments: z.array(z.enum(INSTRUMENT_IDS)).min(1).max(6).optional(),
    motif: motifSchema.optional(),
    /** Quote a public-domain tune in section A (see engine/themes.ts). */
    theme: z.enum(THEME_IDS).optional(),
    density: z.number().min(0).max(1).default(0.5),
    brightness: z.number().min(0).max(1).default(0.5),
    reverb: z.number().min(0).max(1).default(0.4),
  })
  .superRefine((r, ctx) => {
    r.sections.forEach((s, i) => {
      s.progression.forEach((bar, j) => {
        const chords = bar.trim().split(/\s+/);
        if (chords.length > 2 || !chords.every((c) => CHORD_PATTERN.test(c))) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', i, 'progression', j],
            message: `"${bar}" is not a valid bar. Use one or two roman numerals, e.g. "I", "IV V", "vi7".`,
          });
        }
      });
    });
    if (r.motif && r.motif.steps.length !== r.motif.rhythm.length) {
      ctx.addIssue({ code: 'custom', path: ['motif'], message: 'motif.steps and motif.rhythm must be the same length' });
    }
    if (r.form) {
      const names = new Set(r.sections.map((s) => s.name));
      for (const letter of r.form) {
        if (!names.has(letter)) {
          ctx.addIssue({ code: 'custom', path: ['form'], message: `form uses "${letter}" but no section has that name` });
        }
      }
    }
  });

export type Recipe = z.output<typeof recipeSchema>;
export type RecipeInput = z.input<typeof recipeSchema>;

export type ParseResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

/** Parse text pasted from an LLM. Tolerates ```json fences and surrounding prose. */
export function parseRecipeText(text: string): ParseResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, errors: ['No JSON object found. Paste the whole reply.'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, errors: [`That isn't valid JSON: ${(e as Error).message}`] };
  }
  return validateRecipe(raw);
}

export function validateRecipe(raw: unknown): ParseResult {
  const result = recipeSchema.safeParse(raw);
  if (result.success) return { ok: true, recipe: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
  };
}
