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

/** How a pass through the form differs from the previous one, so endless play keeps evolving. */
export interface Variation {
  cycle: number;
  density: number;
  /** Overall loudness 0–1 for this phrase. */
  dynamic: number;
  /** Semitone shift for melody register (0 or ±12). */
  register: number;
  layers: Set<InstrumentId>;
  /** A thinned-out "breathing" pass. */
  breath: boolean;
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
  newRecipe(rng: Rng, space: Space): Recipe;
  /** Events for a whole phrase, `t` relative to the phrase start. */
  renderPhrase(ctx: PhraseContext): NoteEvent[];
}
