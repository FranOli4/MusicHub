import { describe, expect, it } from 'vitest';
import { SPACES, STYLE_IDS, validateRecipe } from '../recipes/schema';
import { Composer } from './composer';
import { newSong, resolveInstruments } from './styles';
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
