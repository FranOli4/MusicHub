import { useSyncExternalStore } from 'react';
import { player, type Playable } from '../engine/player';
import { newSong } from '../engine/styles';
import type { Song } from '../engine/types';
import { db } from '../library/db';
import { listFavourites, toPlayable } from '../library/library';
import type { Space, StyleId } from '../recipes/schema';

// ---------- small persisted preferences (per device) ----------

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

export interface SpaceSettings {
  style: StyleId | 'mix';
  /** Minutes each favourite plays in "Play all". */
  minutes: number;
  shuffle: boolean;
}

const DEFAULTS: Record<Space, SpaceSettings> = {
  think: { style: 'mix', minutes: 20, shuffle: true },
  sleep: { style: 'mix', minutes: 30, shuffle: true },
};

const settingsListeners = new Set<() => void>();
const settingsCache: Partial<Record<Space, SpaceSettings>> = {};

export function getSettings(space: Space): SpaceSettings {
  return (settingsCache[space] ??= load(`mh.settings.${space}`, DEFAULTS[space]));
}

export function updateSettings(space: Space, patch: Partial<SpaceSettings>) {
  settingsCache[space] = { ...getSettings(space), ...patch };
  save(`mh.settings.${space}`, settingsCache[space]);
  settingsListeners.forEach((fn) => fn());
}

export function useSettings(space: Space): SpaceSettings {
  return useSyncExternalStore(
    (fn) => (settingsListeners.add(fn), () => settingsListeners.delete(fn)),
    () => getSettings(space),
  );
}

export const usePlayer = () => useSyncExternalStore(player.subscribe, player.getState);

export function getLastSpace(): Space | null {
  return load<{ space: Space | null }>('mh.lastSpace', { space: null }).space;
}
export function setLastSpace(space: Space | null) {
  save('mh.lastSpace', { space });
}

// ---------- what was last playing in each space ----------

type LastPlayed = { songId: string } | { title: string; song: Song };

function rememberCurrent() {
  const { current } = player.getState();
  if (!current) return;
  let last: LastPlayed;
  if (current.songId) last = { songId: current.songId };
  else if (current.kind === 'generated') last = { title: current.title, song: current.song };
  else return; // unsaved audio preview
  save(`mh.last.${current.space}`, last);
}
player.subscribe(rememberCurrent);

async function lastPlayable(space: Space): Promise<Playable | null> {
  let last: LastPlayed | null = null;
  try {
    const raw = localStorage.getItem(`mh.last.${space}`);
    last = raw ? JSON.parse(raw) : null;
  } catch {
    last = null;
  }
  if (!last) return null;
  if ('songId' in last) {
    const row = await db.songs.get(last.songId);
    return row ? toPlayable(row) : null;
  }
  return { kind: 'generated', title: last.title, space, song: last.song };
}

// ---------- actions ----------

export function playNew(space: Space, style = getSettings(space).style) {
  const song = newSong(space, style);
  return player.play({ kind: 'generated', title: song.recipe.name, space, song });
}

/** Play/pause button: resume, or start this space's last song, or a new one. */
export async function playOrPause(space: Space) {
  const { status, current } = player.getState();
  if (current?.space === space && status !== 'idle') return player.toggle();
  const last = await lastPlayable(space);
  return last ? player.play(last) : playNew(space);
}

/** Entering a space while the other space's music plays: switch to this space's music. */
export async function enterSpace(space: Space) {
  setLastSpace(space);
  const { status, current } = player.getState();
  if (status === 'playing' && current && current.space !== space) {
    const last = await lastPlayable(space);
    await (last ? player.play(last, { fade: 4 }) : playNew(space));
  }
}

export async function playAllFavourites(space: Space, startWith = 0) {
  const rows = await listFavourites(space);
  const { minutes, shuffle } = getSettings(space);
  return player.playRotation(rows.map(toPlayable), minutes, shuffle && startWith === 0, startWith);
}

/** "Next" from buttons, notification or media keys. */
export function next() {
  const { rotation, current } = player.getState();
  if (rotation) return player.next();
  return playNew(current?.space ?? getLastSpace() ?? 'think');
}
