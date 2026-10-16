import type { InstrumentId, Recipe } from '../recipes/schema';
import { Rng } from './rng';
import { resolveInstruments, STYLES } from './styles';
import { mod12, NOTE_PC, parseBar } from './theory';
import type { BarOut, ComposerOptions, FocusLevel, NoteEvent, PhraseContext, Song, TimedChord, Variation } from './types';

// Tuning below follows docs/music-and-concentration.md: steady textures, gradual change,
// moderate tempo in Think, a slow wind-down in Sleep.

const FOCUS_TEMPO: Record<FocusLevel, number> = { deep: 0.88, balanced: 1, routine: 1.1 };
const FOCUS_DENSITY: Record<FocusLevel, number> = { deep: -0.15, balanced: 0, routine: 0.1 };
/** Roughly how long a chapter lasts before fresh motifs (and in Think, a related key) arrive. */
const CHAPTER_SECONDS = { think: 300, sleep: 600 };
/** Think chapters visit IV and V and always come home in between. */
const CHAPTER_KEYS = [0, 5, 0, 7];
/** Sleep slows by up to this fraction as the wind-down completes (iso principle: lead down gradually). */
const WIND_DOWN_SLOWING = 0.15;
/** Instruments whose notes are bowed or sustained, so they can overlap slightly (legato). */
const SUSTAINED = new Set<InstrumentId>(['violin', 'strings', 'cello', 'pad', 'organ']);

interface PlannedSection {
  name: string;
  /** Progression bars, repeated to fill a phrase of at least 8 bars. */
  bars: string[];
}

/** Sections in form order, each expanded to a full phrase. */
function planForm(recipe: Recipe): PlannedSection[] {
  const byName = new Map(recipe.sections.map((s) => [s.name, s.progression]));
  const form = recipe.form ?? recipe.sections.map((s) => s.name).join('');
  return [...form].map((name) => {
    const prog = byName.get(name) ?? recipe.sections[0].progression;
    const reps = prog.length >= 8 ? 1 : Math.ceil(8 / prog.length);
    return { name, bars: Array.from({ length: reps }, () => prog).flat() };
  });
}

/** Tempo actually played: Think scales the recipe tempo by the focus level. */
export function effectiveTempo(recipe: Recipe, focus: FocusLevel = 'balanced'): number {
  return recipe.space === 'think' ? recipe.tempo * FOCUS_TEMPO[focus] : recipe.tempo;
}

/**
 * Endless, deterministic composer. Bar N of a song is always the same notes (for the same options).
 * The form repeats forever; each pass ("cycle") varies density and layering, and every few minutes
 * a new chapter brings fresh motifs, so long listening sessions keep evolving.
 */
export class Composer {
  readonly recipe: Recipe;
  readonly seed: number;
  readonly focus: FocusLevel;
  private readonly windDownAt: (bar: number) => number;
  private readonly form: PlannedSection[];
  private readonly cycleBars: number;
  private readonly chapterCycles: number;
  private readonly phase: number;
  private readonly cache = new Map<number, BarOut[]>();

  constructor(song: Song, opts: ComposerOptions = {}) {
    this.recipe = song.recipe;
    this.seed = song.seed;
    this.focus = song.recipe.space === 'think' ? (opts.focus ?? 'balanced') : 'balanced';
    this.windDownAt = song.recipe.space === 'sleep' && opts.windDown ? opts.windDown : () => 0;
    this.form = planForm(song.recipe);
    this.cycleBars = this.form.reduce((sum, s) => sum + s.bars.length, 0);
    // From the recipe tempo, so chapters line up the same at every focus level.
    const cycleSeconds = this.cycleBars * (60 / song.recipe.tempo) * song.recipe.meter;
    this.chapterCycles = Math.max(2, Math.round(CHAPTER_SECONDS[song.recipe.space] / cycleSeconds));
    this.phase = Rng.from(song.seed, 'phase').range(0, Math.PI * 2);
  }

  get beatsPerBar(): number {
    return this.recipe.meter;
  }

  get tempo(): number {
    return effectiveTempo(this.recipe, this.focus);
  }

  /** Seconds per bar at the playing tempo (before any wind-down slowing). */
  get barSeconds(): number {
    return (60 / this.tempo) * this.recipe.meter;
  }

  /** Seconds bar `index` lasts; Sleep gradually slows as it winds down. */
  barSecondsAt(index: number): number {
    return this.barSeconds * (1 + WIND_DOWN_SLOWING * clamp01(this.windDownAt(index)));
  }

  bar(index: number): BarOut {
    const cycle = Math.floor(index / this.cycleBars);
    let offset = index - cycle * this.cycleBars;
    let formPos = 0;
    while (offset >= this.form[formPos].bars.length) {
      offset -= this.form[formPos].bars.length;
      formPos++;
    }
    const phraseIndex = cycle * this.form.length + formPos;
    let phrase = this.cache.get(phraseIndex);
    if (!phrase) {
      phrase = this.renderPhrase(cycle, formPos, index - offset);
      this.cache.set(phraseIndex, phrase);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    }
    return phrase[offset];
  }

  /** Number of phrases in one pass through the form. */
  get formLength(): number {
    return this.form.length;
  }

  /** First bar of a phrase. */
  phraseStart(cycle: number, formPos: number): number {
    let bar = cycle * this.cycleBars;
    for (let p = 0; p < formPos; p++) bar += this.form[p].bars.length;
    return bar;
  }

  chapterOf(cycle: number): number {
    return Math.floor(cycle / this.chapterCycles);
  }

  /** Overall loudness 0–1 at an absolute bar position: a slow, continuous drift (no steps between phrases). */
  dynamicAt(bar: number): number {
    const sleep = this.recipe.space === 'sleep';
    // One swell roughly every 1.7 passes through the form.
    const drift = Math.sin(this.phase + (bar / (this.cycleBars * 1.7)) * Math.PI * 2);
    if (sleep) return 0.45 + drift * 0.06 - 0.1 * clamp01(this.windDownAt(bar));
    return clamp01(0.65 + drift * 0.14);
  }

  variation(cycle: number, formPos: number): Variation {
    const { recipe, seed } = this;
    const rng = Rng.from(seed, 'variation', cycle, formPos);
    const sleep = recipe.space === 'sleep';
    const windDown = clamp01(this.windDownAt(this.phraseStart(cycle, formPos)));
    const drift = Math.sin(cycle * 0.85 + formPos * 0.4 + this.phase);
    const density = clamp01(recipe.density + drift * (sleep ? 0.1 : 0.15) + FOCUS_DENSITY[this.focus] - windDown * 0.15);
    const breath = sleep ? cycle > 0 && cycle % 3 === 2 && formPos === 0 : cycle > 0 && cycle % 5 === 4 && formPos === 0;
    const chapter = this.chapterOf(cycle);

    const all = resolveInstruments(recipe).roles;
    const bed = STYLES[recipe.style].bed;
    const layers = new Set<InstrumentId>(all);
    const drop = (i: InstrumentId) => i !== bed && layers.delete(i);
    // Open gently: the first phrase leaves out the most decorative layer.
    if (cycle === 0 && formPos === 0 && all.length > 2) drop(all[all.length - 1]);
    // Later cycles occasionally drop one layer for contrast.
    else if (all.length > 2 && rng.chance(0.3)) drop(all[rng.int(1, all.length - 1)]);
    if (breath) for (const i of all.slice(2)) drop(i);

    return {
      cycle,
      chapter,
      transpose: sleep ? 0 : CHAPTER_KEYS[chapter % CHAPTER_KEYS.length],
      focus: this.focus,
      windDown,
      density: breath ? density * 0.5 : density,
      dynamic: this.dynamicAt(this.phraseStart(cycle, formPos)),
      register: 0,
      layers,
      breath,
      // Once Sleep has wound down, every other phrase leaves the tune out: fewer hooks to become earworms.
      lead: !(sleep && windDown >= 1 && (cycle + formPos) % 2 === 1),
      develop: cycle % 3 === 2,
    };
  }

  /** The phrase before/after (cycle, formPos) in play order, or null before the start. */
  private neighbour(cycle: number, formPos: number, step: 1 | -1): [number, number] | null {
    const p = cycle * this.form.length + formPos + step;
    if (p < 0) return null;
    return [Math.floor(p / this.form.length), p % this.form.length];
  }

  private renderPhrase(cycle: number, formPos: number, firstBar: number): BarOut[] {
    const { recipe, seed } = this;
    const section = this.form[formPos];
    const meter = recipe.meter;
    const variation = this.variation(cycle, formPos);
    const keyPc = mod12(NOTE_PC[recipe.key] + variation.transpose);
    const chords: TimedChord[] = [];
    const barChords: string[][] = [];
    section.bars.forEach((bar, b) => {
      for (const c of parseBar(bar, recipe, keyPc)) chords.push({ ...c, at: b * meter + c.at });
      barChords.push(bar.trim().split(/\s+/));
    });

    // Melodic identity comes from the section; realisation varies a little per cycle, and chapters re-derive it.
    const chapterPart = variation.chapter % 3;
    const ctx: PhraseContext = {
      recipe,
      seed,
      rng: chapterPart
        ? Rng.from(seed, 'phrase', section.name, cycle % 3, formPos, 'chapter', chapterPart)
        : Rng.from(seed, 'phrase', section.name, cycle % 3, formPos),
      section: section.name,
      formPos,
      formLength: this.form.length,
      bars: section.bars.length,
      meter,
      keyPc,
      chords,
      chordAt(beat: number) {
        for (let i = chords.length - 1; i >= 0; i--) if (beat >= chords[i].at - 1e-6) return chords[i].chord;
        return chords[0].chord;
      },
      variation,
      has: (i) => variation.layers.has(i),
    };

    const prev = this.neighbour(cycle, formPos, -1);
    const next = this.neighbour(cycle, formPos, 1)!;
    const shape: Shaping = {
      total: section.bars.length * meter,
      ramp: Math.min(2, Math.floor(section.bars.length / 2)) * meter,
      entering: prev ? new Set([...variation.layers].filter((i) => !this.variation(...prev).layers.has(i))) : new Set(),
      leaving: new Set([...variation.layers].filter((i) => !this.variation(...next).layers.has(i))),
      dynamicAt: (beat) => this.dynamicAt(firstBar + beat / meter),
    };

    const events = STYLES[recipe.style].renderPhrase(ctx).map((e) => shapeEvent(e, recipe, shape));
    const out: BarOut[] = section.bars.map((_, b) => ({
      index: firstBar + b,
      section: section.name,
      chords: barChords[b],
      events: [],
    }));
    for (const e of events) {
      const b = Math.floor(e.t / meter + 1e-6);
      if (b < 0 || b >= out.length || e.d <= 0) continue;
      out[b].events.push({ ...e, t: e.t - b * meter });
    }
    for (const bar of out) bar.events.sort((a, b) => a.t - b.t);
    return out;
  }
}

interface Shaping {
  /** Phrase length in beats. */
  total: number;
  /** Beats over which a layer fades in or out. */
  ramp: number;
  /** Layers absent from the previous phrase (fade in) / from the next phrase (fade out). */
  entering: Set<InstrumentId>;
  leaving: Set<InstrumentId>;
  dynamicAt(beat: number): number;
}

/**
 * Shared shaping for every style:
 * - loudness follows the slow, continuous dynamic curve;
 * - layers that come or go between phrases fade over two bars instead of switching abruptly;
 * - bowed and sustained notes overlap slightly (legato) so the texture stays continuous;
 * - Sleep stays soft.
 */
function shapeEvent(e: NoteEvent, recipe: Recipe, s: Shaping): NoteEvent {
  let v = e.v * (0.55 + 0.45 * s.dynamicAt(e.t));
  if (s.ramp > 0) {
    if (s.entering.has(e.i) && e.t < s.ramp) v *= 0.3 + 0.7 * (e.t / s.ramp);
    if (s.leaving.has(e.i) && e.t > s.total - s.ramp) v *= 0.3 + 0.7 * ((s.total - e.t) / s.ramp);
  }
  if (recipe.space === 'sleep') v = Math.min(0.55, v * 0.8);
  const d = SUSTAINED.has(e.i) ? e.d * 1.05 : e.d;
  return { ...e, d, v: Math.max(0.05, Math.min(1, v)) };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
