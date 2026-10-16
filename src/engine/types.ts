import type { InstrumentId, Recipe, Space, StyleId } from '../recipes/schema';
import type { Chord } from './theory';
import type { Rng } from './rng';

/** A note, timed in beats (quarter notes) from the start of its bar or phrase. */
export interface NoteEvent {
  t: number;
  d: number;
  m: number;
  /** Velocity 0–1. */
  v: number;
  i: InstrumentId;
}

/** A generated song is fully described by its recipe and seed. */
export interface Song {
  recipe: Recipe;
  seed: number;
}

export interface BarOut {
  index: number;
  section: string;
  chords: string[];
  events: NoteEvent[];
}

export interface TimedChord {
  chord: Chord;
  /** Beat offset from the phrase start. */
  at: number;
  len: number;
}

/**
 * Arousal control for Think (see docs/music-and-concentration.md): calmer for reading and
 * complex work, livelier for routine tasks. Changes tempo and texture, never the tune.
 */
export type FocusLevel = 'deep' | 'balanced' | 'routine';
export const FOCUS_LEVELS: FocusLevel[] = ['deep', 'balanced', 'routine'];

export interface ComposerOptions {
  focus?: FocusLevel;
  /** Sleep wind-down progress 0–1 at a given bar (slower, sparser, softer over the session). */
  windDown?: (bar: number) => number;
}

/** How a pass through the form differs from the previous one, so endless play keeps evolving. */
export interface Variation {
  cycle: number;
  /** Long-form section of several cycles: brings fresh motifs and (in Think) a related key. */
  chapter: number;
  /** Semitones the chapter is transposed by (0, +5 or +7). */
  transpose: number;
  focus: FocusLevel;
  /** Sleep wind-down progress 0–1. */
  windDown: number;
  density: number;
  /** Overall loudness 0–1 for this phrase. */
  dynamic: number;
  /** Semitone shift for melody register (kept at 0: octave jumps are attention-grabbing). */
  register: number;
  layers: Set<InstrumentId>;
  /** A thinned-out "breathing" pass. */
  breath: boolean;
  /** The tune plays this phrase (Sleep leaves it out of alternate phrases once wound down). */
  lead: boolean;
  /** Melody is developed (sequenced/inverted) rather than stated plainly. */
  develop: boolean;
}

export interface PhraseContext {
  recipe: Recipe;
  seed: number;
  rng: Rng;
  section: string;
  /** Position of this phrase within the form (0-based), and the form length. */
  formPos: number;
  formLength: number;
  bars: number;
  meter: number;
  keyPc: number;
  chords: TimedChord[];
  chordAt(beat: number): Chord;
  variation: Variation;
  has(instrument: InstrumentId): boolean;
}

export interface StyleDef {
  id: StyleId;
  label: string;
  family: 'worship' | 'classical';
  blurb: string;
  /** Spaces this style is offered in for "New song". */
  spaces: Space[];
  instruments: InstrumentId[];
  /** Sustained layer that is never dropped, so the texture never chops into silence. */
  bed: InstrumentId;
  newRecipe(rng: Rng, space: Space): Recipe;
  /** Events for a whole phrase, `t` relative to the phrase start. */
  renderPhrase(ctx: PhraseContext): NoteEvent[];
}
