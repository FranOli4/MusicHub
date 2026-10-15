import type { InstrumentId, Recipe } from '../recipes/schema';
import { Rng } from './rng';
import { resolveInstruments, STYLES } from './styles';
import { NOTE_PC, parseBar } from './theory';
import type { BarOut, NoteEvent, PhraseContext, Song, TimedChord, Variation } from './types';

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

/**
 * Endless, deterministic composer. Bar N of a song is always the same notes.
 * The form repeats forever; each pass ("cycle") varies density, register and layering
 * so long listening sessions keep evolving.
 */
export class Composer {
  readonly recipe: Recipe;
  readonly seed: number;
  private readonly form: PlannedSection[];
  private readonly cycleBars: number;
  private readonly cache = new Map<number, BarOut[]>();

  constructor(song: Song) {
    this.recipe = song.recipe;
    this.seed = song.seed;
    this.form = planForm(song.recipe);
    this.cycleBars = this.form.reduce((sum, s) => sum + s.bars.length, 0);
  }

  get beatsPerBar(): number {
    return this.recipe.meter;
  }

  /** Seconds per bar at the recipe tempo. */
  get barSeconds(): number {
    return (60 / this.recipe.tempo) * this.recipe.meter;
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

  variation(cycle: number, formPos: number): Variation {
    const { recipe, seed } = this;
    const rng = Rng.from(seed, 'variation', cycle, formPos);
    const sleep = recipe.space === 'sleep';
    const phase = Rng.from(seed, 'phase').range(0, Math.PI * 2);
    const drift = Math.sin(cycle * 0.85 + formPos * 0.4 + phase);
    const density = clamp01(recipe.density + drift * (sleep ? 0.12 : 0.2));
    const breath = sleep ? cycle > 0 && cycle % 3 === 2 && formPos === 0 : cycle > 0 && cycle % 5 === 4 && formPos === 0;

    const all = resolveInstruments(recipe).roles;
    const layers = new Set<InstrumentId>(all);
    // Open gently: the first phrase leaves out the most decorative layer.
    if (cycle === 0 && formPos === 0 && all.length > 2) layers.delete(all[all.length - 1]);
    // Later cycles occasionally drop one layer for contrast.
    else if (all.length > 2 && rng.chance(0.3)) layers.delete(all[rng.int(1, all.length - 1)]);
    if (breath) for (const i of all.slice(2)) layers.delete(i);

    return {
      cycle,
      density: breath ? density * 0.5 : density,
      dynamic: sleep ? 0.45 + drift * 0.08 : clamp01(0.65 + drift * 0.18 + (formPos % 2 ? -0.05 : 0.05)),
      register: !sleep && cycle % 4 === 3 ? 12 : 0,
      layers,
      breath,
      develop: cycle % 3 === 2,
    };
  }

  private renderPhrase(cycle: number, formPos: number, firstBar: number): BarOut[] {
    const { recipe, seed } = this;
    const section = this.form[formPos];
    const meter = recipe.meter;
    const chords: TimedChord[] = [];
    const barChords: string[][] = [];
    section.bars.forEach((bar, b) => {
      for (const c of parseBar(bar, recipe)) chords.push({ ...c, at: b * meter + c.at });
      barChords.push(bar.trim().split(/\s+/));
    });
    const variation = this.variation(cycle, formPos);

    const ctx: PhraseContext = {
      recipe,
      seed,
      // Melodic identity comes from the section; realisation varies a little per cycle.
      rng: Rng.from(seed, 'phrase', section.name, cycle % 3, formPos),
      section: section.name,
      formPos,
      formLength: this.form.length,
      bars: section.bars.length,
      meter,
      keyPc: NOTE_PC[recipe.key],
      chords,
      chordAt(beat: number) {
        for (let i = chords.length - 1; i >= 0; i--) if (beat >= chords[i].at - 1e-6) return chords[i].chord;
        return chords[0].chord;
      },
      variation,
      has: (i) => variation.layers.has(i),
    };

    const events = STYLES[recipe.style].renderPhrase(ctx).map((e) => shapeForSpace(e, recipe, variation));
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

/** Sleep keeps everything soft and avoids sharp attacks; Think follows the phrase dynamic. */
function shapeForSpace(e: NoteEvent, recipe: Recipe, variation: Variation): NoteEvent {
  let v = e.v * (0.55 + 0.45 * variation.dynamic);
  if (recipe.space === 'sleep') v = Math.min(0.55, v * 0.8);
  return { ...e, v: Math.max(0.05, Math.min(1, v)) };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
