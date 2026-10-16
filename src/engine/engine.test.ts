import { describe, expect, it } from 'vitest';
import { SPACES, STYLE_IDS, validateRecipe } from '../recipes/schema';
import { Composer } from './composer';
import { newSong, resolveInstruments, STYLES } from './styles';
import type { NoteEvent } from './types';
import { parseChord } from './theory';

describe('theory', () => {
  it('parses roman numerals in major and minor', () => {
    expect(parseChord('I', 0, 'major').pcs).toEqual([0, 4, 7]);
    expect(parseChord('vi', 0, 'major').pcs).toEqual([9, 0, 4]);
    expect(parseChord('V7', 0, 'major').pcs).toEqual([7, 11, 2, 5]);
    expect(parseChord('IVadd9', 0, 'major').pcs).toEqual([5, 9, 0, 7]);
    expect(parseChord('Vsus4', 7, 'major').pcs).toEqual([2, 7, 9]);
    expect(parseChord('I/3', 0, 'major').bassPc).toBe(4);
    expect(parseChord('V', 9, 'minor').pcs).toEqual([4, 8, 11]); // E major in A minor
    expect(parseChord('VII', 9, 'minor').pcs).toEqual([7, 11, 2]);
    expect(parseChord('iio', 9, 'minor').pcs).toEqual([11, 2, 5]);
  });
});

describe('composer', () => {
  it('is deterministic for a given song', () => {
    const song = newSong('think', 'mozart', 12345);
    const a = new Composer(song);
    const b = new Composer(structuredClone(song));
    for (const n of [0, 1, 7, 40, 333, 1000]) expect(a.bar(n)).toEqual(b.bar(n));
  });

  it('gives different music for different seeds', () => {
    const a = new Composer(newSong('think', 'worship-piano', 1)).bar(0);
    const b = new Composer(newSong('think', 'worship-piano', 2)).bar(0);
    expect(a.events).not.toEqual(b.events);
  });

  for (const space of SPACES) {
    for (const style of STYLE_IDS) {
      it(`${style} in ${space}: valid recipes and 2,000 gap-free bars`, () => {
        for (const seed of [1, 99, 2024]) {
          const song = newSong(space, style, seed);
          const check = validateRecipe(song.recipe);
          expect(check.ok, JSON.stringify(check)).toBe(true);
          const composer = new Composer(song);
          const allowed = resolveInstruments(song.recipe).roles;
          const problems: string[] = [];
          let silentRun = 0;
          for (let n = 0; n < 2000; n++) {
            const bar = composer.bar(n);
            if (bar.index !== n) problems.push(`bar ${n} has index ${bar.index}`);
            for (const e of bar.events) {
              if (e.m < 21 || e.m > 108) problems.push(`bar ${n}: pitch ${e.m}`);
              if (!(e.v > 0 && e.v <= 1)) problems.push(`bar ${n}: velocity ${e.v}`);
              if (!(e.d > 0)) problems.push(`bar ${n}: duration ${e.d}`);
              if (e.t < 0 || e.t >= song.recipe.meter) problems.push(`bar ${n}: time ${e.t}`);
              if (!allowed.includes(e.i)) problems.push(`bar ${n}: instrument ${e.i}`);
            }
            silentRun = bar.events.length ? 0 : silentRun + 1;
            if (silentRun >= 2) problems.push(`bars ${n - 1}-${n} silent`);
          }
          expect(problems.slice(0, 5)).toEqual([]);
        }
      });
    }
  }

  it('maps recipe instruments onto style roles', () => {
    const song = newSong('think', 'worship-piano', 3);
    const { roles, sound } = resolveInstruments({ ...song.recipe, instruments: ['harp', 'organ'] });
    expect(roles).toEqual(['piano', 'pad']);
    expect(sound.get('piano')).toBe('harp');
    expect(sound.get('pad')).toBe('organ');
  });

  it('keeps sleep quiet', () => {
    const composer = new Composer(newSong('sleep', 'vivaldi', 7));
    for (let n = 0; n < 200; n++) for (const e of composer.bar(n).events) expect(e.v).toBeLessThanOrEqual(0.55);
  });

  it('quotes a theme when the recipe asks for one', () => {
    const song = newSong('think', 'worship-piano', 1);
    song.recipe = {
      ...song.recipe, theme: 'hymn-to-joy', key: 'C', meter: 4, form: 'AABA',
      sections: [
        { name: 'A', progression: ['I', 'V7', 'I', 'I V', 'I', 'V7', 'I', 'V I'] },
        { name: 'B', progression: ['V I', 'V I', 'V', 'I V', 'I', 'V7', 'I', 'V I'] },
      ],
    };
    const first = new Composer(song).bar(0).events.filter((e) => e.i === 'piano' && e.m >= 64);
    const pcs = first.filter((e) => Number.isInteger(e.t)).map((e) => e.m % 12);
    expect(pcs).toEqual(expect.arrayContaining([4, 5, 7])); // E E F G
  });
});

// Targets from docs/music-and-concentration.md: steady, legato, predictable, gradual.
describe('focus and sleep shaping', () => {
  const LEAD = { 'worship-piano': 'piano', 'worship-ambient': 'piano', mozart: 'violin', vivaldi: 'violin', adagio: 'violin' } as const;
  /** The tune: the lead instrument's upper, louder notes (Vivaldi's solo figuration excluded). */
  const isLead = (style: (typeof STYLE_IDS)[number], e: NoteEvent, section: string) =>
    e.i === LEAD[style] && (!style.startsWith('worship') || (e.m >= 62 && e.v > 0.32)) && !(style === 'vivaldi' && section !== 'A');

  function stats(space: (typeof SPACES)[number], style: (typeof STYLE_IDS)[number], focus: 'deep' | 'balanced' | 'routine') {
    let onsets = 0, lead = 0, secs = 0, near = 0, moves = 0, top = 0, gap = 0;
    for (const seed of [1, 99, 2024]) {
      const c = new Composer(newSong(space, style, seed), { focus });
      const beat = c.barSeconds / c.recipe.meter;
      let prev: number | null = null;
      let covered = 0;
      for (let n = 0; n < 300; n++) {
        const bar = c.bar(n);
        secs += c.barSeconds;
        onsets += new Set(bar.events.map((e) => Math.round(e.t * 100))).size;
        const tune = bar.events.filter((e) => isLead(style, e, bar.section));
        lead += new Set(tune.map((e) => Math.round(e.t * 100))).size;
        for (const e of tune) {
          top = Math.max(top, e.m);
          if (prev !== null) {
            moves++;
            if (Math.abs(e.m - prev) <= 2) near++;
          }
          prev = e.m;
        }
        for (const e of bar.events) {
          const at = n * c.recipe.meter + e.t;
          if (n > 8 && at > covered) gap = Math.max(gap, (at - covered) * beat);
          covered = Math.max(covered, at + e.d);
        }
      }
    }
    return { onsetsPerSec: onsets / secs, leadPerSec: lead / secs, conjunct: moves ? near / moves : 1, top, gap };
  }

  for (const style of STYLE_IDS) {
    it(`${style}: steady Think texture`, () => {
      for (const focus of ['deep', 'balanced'] as const) {
        const s = stats('think', style, focus);
        expect(s.onsetsPerSec, `${focus} onsets/s`).toBeLessThanOrEqual(4);
        expect(s.leadPerSec, `${focus} melody notes/s`).toBeLessThanOrEqual(2.5);
        // The ambient tune is a few long notes over changing chords, so it leaps a little more often.
        expect(s.conjunct, `${focus} stepwise share`).toBeGreaterThanOrEqual(style === 'worship-ambient' ? 0.58 : 0.65);
        expect(s.top, `${focus} highest melody note`).toBeLessThanOrEqual(91);
        expect(s.gap, `${focus} longest silence (s)`).toBeLessThanOrEqual(0.5);
      }
    });

    it(`${style}: calm Sleep texture`, () => {
      const s = stats('sleep', style, 'balanced');
      expect(s.onsetsPerSec).toBeLessThanOrEqual(1.2);
      expect(s.leadPerSec).toBeLessThanOrEqual(0.8);
      expect(s.top).toBeLessThanOrEqual(84);
      expect(s.gap).toBeLessThanOrEqual(0.5);
    });

    it(`${style}: never drops its sustained bed`, () => {
      for (const space of SPACES) {
        const c = new Composer(newSong(space, style, 42));
        const bed = STYLES[style].bed;
        for (let cycle = 0; cycle < 60; cycle++) for (let p = 0; p < 3; p++) expect(c.variation(cycle, p).layers.has(bed)).toBe(true);
      }
    });
  }

  it('changes loudness gradually from bar to bar', () => {
    for (const space of SPACES) {
      const c = new Composer(newSong(space, 'vivaldi', 5));
      const gain = (n: number) => 0.55 + 0.45 * c.dynamicAt(n);
      let span = [Infinity, -Infinity];
      for (let n = 1; n < 2000; n++) {
        expect(Math.abs(20 * Math.log10(gain(n) / gain(n - 1)))).toBeLessThan(0.5);
        span = [Math.min(span[0], gain(n)), Math.max(span[1], gain(n))];
      }
      expect(20 * Math.log10(span[1] / span[0])).toBeLessThanOrEqual(space === 'sleep' ? 3 : 5);
    }
  });

  it('fades layers in and out between phrases instead of switching abruptly', () => {
    let checked = 0;
    for (const seed of [11, 12, 13, 14, 15]) {
      const c = new Composer(newSong('think', 'worship-piano', seed));
      for (let cycle = 1; cycle < 12; cycle++) {
        for (let p = 0; p < c.formLength; p++) {
          const prev = p ? c.variation(cycle, p - 1) : c.variation(cycle - 1, c.formLength - 1);
          const now = c.variation(cycle, p);
          const entering = [...now.layers].find((i) => !prev.layers.has(i));
          if (!entering) continue;
          const start = c.phraseStart(cycle, p);
          const mean = (n: number) => {
            const v = c.bar(n).events.filter((e) => e.i === entering).map((e) => e.v);
            return v.reduce((a, b) => a + b, 0) / v.length;
          };
          expect(mean(start), `${entering} enters softly`).toBeLessThan(mean(start + 3));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('moves through chapters deterministically, always returning home', () => {
    const song = newSong('think', 'mozart', 8);
    const a = new Composer(song);
    const b = new Composer(structuredClone(song));
    const keys: number[] = [];
    for (let cycle = 0; cycle < 120; cycle++) {
      const v = a.variation(cycle, 0);
      expect(v.transpose).toBe(b.variation(cycle, 0).transpose);
      if (keys[keys.length - 1] !== v.transpose) keys.push(v.transpose);
    }
    expect(keys[0]).toBe(0);
    expect(keys.length).toBeGreaterThan(3);
    keys.forEach((k, i) => i % 2 === 0 ? expect(k).toBe(0) : expect([5, 7]).toContain(k));
    expect(new Composer(newSong('sleep', 'adagio', 8)).variation(400, 0).transpose).toBe(0);
  });

  it('focus level changes tempo and texture but not the tune', () => {
    const song = newSong('think', 'mozart', 31);
    const tune = (c: Composer) => Array.from({ length: 64 }, (_, n) => c.bar(n).events.filter((e) => e.i === 'violin').map((e) => e.m)).flat();
    const deep = new Composer(song, { focus: 'deep' });
    const balanced = new Composer(song, { focus: 'balanced' });
    const routine = new Composer(song, { focus: 'routine' });
    expect(deep.tempo).toBeLessThan(balanced.tempo);
    expect(balanced.tempo).toBeLessThan(routine.tempo);
    expect(tune(deep)).toEqual(tune(balanced));
    expect(tune(routine)).toEqual(tune(balanced));
    // Sleep ignores the focus level.
    const sleepSong = newSong('sleep', 'adagio', 31);
    expect(new Composer(sleepSong, { focus: 'routine' }).tempo).toBe(sleepSong.recipe.tempo);
  });

  it('winds Sleep down: sparser, softer and slower', () => {
    const song = newSong('sleep', 'worship-piano', 4);
    const fresh = new Composer(song, { windDown: () => 0 });
    const late = new Composer(song, { windDown: () => 1 });
    expect(late.variation(3, 0).density).toBeLessThan(fresh.variation(3, 0).density);
    expect(late.dynamicAt(100)).toBeLessThan(fresh.dynamicAt(100));
    expect(late.barSecondsAt(100)).toBeGreaterThan(fresh.barSecondsAt(100));
    const count = (c: Composer) => Array.from({ length: 64 }, (_, n) => c.bar(n).events.length).reduce((a, b) => a + b, 0);
    expect(count(late)).toBeLessThanOrEqual(count(fresh));
  });
});
