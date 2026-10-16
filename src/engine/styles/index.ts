import type { InstrumentId, Recipe, Space, StyleId } from '../../recipes/schema';
import { Rng, randomSeed } from '../rng';
import type { Song, StyleDef } from '../types';
import { adagio, mozart, vivaldi } from './classical';
import { bach, handel, haydn, schubert } from './composers';
import { worshipAmbient, worshipPiano } from './worship';

export const STYLES: Record<StyleId, StyleDef> = {
  'worship-piano': worshipPiano,
  'worship-ambient': worshipAmbient,
  mozart,
  vivaldi,
  bach,
  handel,
  haydn,
  schubert,
  adagio,
};

/** What a style chip can ask for: one style, any classical composer, or anything. */
export type StyleChoice = StyleId | 'classical' | 'mix';

/** Composers the "Classical" chip picks between. Each one's Sleep version is a slow movement. */
export const CLASSICAL_STYLES: StyleId[] = ['mozart', 'vivaldi', 'bach', 'handel', 'haydn', 'schubert'];

/** Style chips offered in each space, in display order. */
export const SPACE_STYLES: Record<Space, Exclude<StyleChoice, 'mix'>[]> = {
  think: ['worship-piano', 'classical', 'adagio'],
  sleep: ['worship-ambient', 'worship-piano', 'adagio', 'classical'],
};

/** Labels tuned per space ("Vivaldi" in Sleep means a Largo, Mozart a Romanze). */
export function styleLabel(style: Exclude<StyleChoice, 'mix'>, space: Space): string {
  if (style === 'classical') return 'Classical';
  if (space === 'sleep' && style === 'mozart') return 'Mozart Romanze';
  if (space === 'sleep' && style === 'vivaldi') return 'Vivaldi Largo';
  return STYLES[style].label;
}

/** A song's style for display: classical songs name their composer. */
export function songStyleLabel(style: StyleId, space: Space): string {
  return CLASSICAL_STYLES.includes(style) ? `Classical · ${styleLabel(style, space)}` : styleLabel(style, space);
}

/** A brand-new song. "mix" picks one of the space's chips; "classical" then picks a composer. */
export function newSong(space: Space, style: StyleChoice, seed = randomSeed()): Song {
  const rng = Rng.from(seed, 'recipe');
  const chip = style === 'mix' ? rng.pick(SPACE_STYLES[space]) : style;
  const chosen = chip === 'classical' ? rng.pick(CLASSICAL_STYLES) : chip;
  return { recipe: STYLES[chosen].newRecipe(rng, space), seed };
}

const FAMILY: Record<InstrumentId, 'keys' | 'sustain' | 'lead' | 'low'> = {
  piano: 'keys', harp: 'keys', harpsichord: 'keys',
  pad: 'sustain', organ: 'sustain', strings: 'sustain',
  violin: 'lead',
  cello: 'low', bass: 'low', pizz: 'low',
};

/**
 * A style writes parts for its own instruments ("roles"). A recipe's `instruments` list picks
 * which sound plays each role: an exact match first, then a free instrument of the same family.
 * Roles nobody plays are muted, unless that would mute everything.
 */
export function resolveInstruments(recipe: Recipe): { roles: InstrumentId[]; sound: Map<InstrumentId, InstrumentId> } {
  const styleRoles = STYLES[recipe.style].instruments;
  const identity = new Map(styleRoles.map((r) => [r, r] as const));
  if (!recipe.instruments) return { roles: styleRoles, sound: identity };
  const wanted = new Set(recipe.instruments);
  const sound = new Map<InstrumentId, InstrumentId>();
  for (const role of styleRoles) if (wanted.delete(role)) sound.set(role, role);
  for (const role of styleRoles) {
    if (sound.has(role)) continue;
    const sub = [...wanted].find((w) => FAMILY[w] === FAMILY[role]);
    if (sub) {
      sound.set(role, sub);
      wanted.delete(sub);
    }
  }
  if (!sound.size) return { roles: styleRoles, sound: identity };
  return { roles: styleRoles.filter((r) => sound.has(r)), sound };
}
