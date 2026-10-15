import type { InstrumentId, Recipe, Space, StyleId } from '../../recipes/schema';
import { Rng, randomSeed } from '../rng';
import type { Song, StyleDef } from '../types';
import { adagio, mozart, vivaldi } from './classical';
import { worshipAmbient, worshipPiano } from './worship';

export const STYLES: Record<StyleId, StyleDef> = {
  'worship-piano': worshipPiano,
  'worship-ambient': worshipAmbient,
  mozart,
  vivaldi,
  adagio,
};

/** Style chips offered in each space, in display order. */
export const SPACE_STYLES: Record<Space, StyleId[]> = {
  think: ['worship-piano', 'mozart', 'vivaldi', 'adagio'],
  sleep: ['worship-ambient', 'worship-piano', 'adagio', 'mozart', 'vivaldi'],
};

/** Labels tuned per space ("Vivaldi" in Sleep means a Largo, Mozart a Romanze). */
export function styleLabel(style: StyleId, space: Space): string {
  if (space === 'sleep' && style === 'mozart') return 'Mozart Romanze';
  if (space === 'sleep' && style === 'vivaldi') return 'Vivaldi Largo';
  return STYLES[style].label;
}

/** A brand-new song. `style` = "mix" picks one of the space's styles. */
export function newSong(space: Space, style: StyleId | 'mix', seed = randomSeed()): Song {
  const rng = Rng.from(seed, 'recipe');
  const chosen = style === 'mix' ? rng.pick(SPACE_STYLES[space]) : style;
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
