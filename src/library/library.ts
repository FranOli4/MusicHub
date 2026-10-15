import type { Playable } from '../engine/player';
import { randomSeed } from '../engine/rng';
import type { Song } from '../engine/types';
import type { LoopSettings } from '../engine/voices';
import type { Recipe, Space } from '../recipes/schema';
import { db, newId, type SongRow } from './db';

/** Turn a stored song into something the player can play. The row's space always wins. */
export function toPlayable(row: SongRow): Playable {
  if (row.kind === 'audio') {
    const audioId = row.audioId!;
    return {
      kind: 'audio',
      title: row.title,
      space: row.space,
      songId: row.id,
      loop: row.loop ?? { crossfade: 2 },
      load: async () => {
        const audio = await db.audio.get(audioId);
        if (!audio) throw new Error('Audio file is missing from this device');
        return audio.blob;
      },
    };
  }
  return {
    kind: 'generated',
    title: row.title,
    space: row.space,
    songId: row.id,
    song: { recipe: { ...row.recipe!, space: row.space }, seed: row.seed! },
  };
}

/** Favourite whatever is playing. Generated songs are only stored once favourited. */
export async function favourite(item: Playable): Promise<string> {
  if (item.songId) {
    await db.songs.update(item.songId, { favourite: 1, favouritedAt: Date.now() });
    return item.songId;
  }
  if (item.kind !== 'generated') throw new Error('Audio songs are always stored');
  return saveGenerated(item.space, item.title, item.song, true);
}

export async function saveGenerated(space: Space, title: string, song: Song, fav: boolean): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.songs.add({
    id,
    space,
    kind: 'generated',
    title,
    recipe: song.recipe,
    seed: song.seed,
    favourite: fav ? 1 : 0,
    createdAt: now,
    favouritedAt: fav ? now : undefined,
  });
  return id;
}

/** Un-favouriting a plain generated song removes it; added songs stay in "My songs". */
export async function unfavourite(id: string): Promise<void> {
  const row = await db.songs.get(id);
  if (!row) return;
  if (row.kind === 'generated') await db.songs.delete(id);
  else await db.songs.update(id, { favourite: 0, favouritedAt: undefined });
}

export async function rename(id: string, title: string): Promise<void> {
  await db.songs.update(id, { title: title.trim() || 'Untitled' });
}

export async function removeSong(id: string): Promise<void> {
  await db.transaction('rw', db.songs, db.audio, async () => {
    const row = await db.songs.get(id);
    if (!row) return;
    await db.songs.delete(id);
    if (row.audioId) {
      const stillUsed = await db.songs.filter((s) => s.audioId === row.audioId).count();
      if (!stillUsed) await db.audio.delete(row.audioId);
    }
  });
}

/** Copy a song into the other space (Think ↔ Sleep). Audio data is shared, not duplicated. */
export async function copyToSpace(id: string, space: Space): Promise<void> {
  const row = await db.songs.get(id);
  if (!row) return;
  const now = Date.now();
  await db.songs.add({
    ...row,
    id: newId(),
    space,
    recipe: row.recipe ? { ...row.recipe, space } : undefined,
    favourite: 1,
    createdAt: now,
    favouritedAt: now,
  });
}

export async function addRecipe(space: Space, recipe: Recipe, seed = randomSeed()): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.songs.add({
    id, space, kind: 'recipe', title: recipe.name, recipe: { ...recipe, space }, seed,
    favourite: 1, createdAt: now, favouritedAt: now,
  });
  return id;
}

export async function addAudio(space: Space, title: string, blob: Blob, name: string, loop: LoopSettings): Promise<string> {
  const id = newId();
  const audioId = newId();
  const now = Date.now();
  await db.transaction('rw', db.songs, db.audio, async () => {
    await db.audio.add({ id: audioId, name, type: blob.type, blob });
    await db.songs.add({ id, space, kind: 'audio', title, audioId, loop, favourite: 1, createdAt: now, favouritedAt: now });
  });
  return id;
}

export async function updateLoop(id: string, loop: LoopSettings): Promise<void> {
  await db.songs.update(id, { loop });
}

export function listFavourites(space: Space): Promise<SongRow[]> {
  return db.songs
    .where('[space+favourite]')
    .equals([space, 1])
    .toArray()
    .then((rows) => rows.sort((a, b) => (b.favouritedAt ?? 0) - (a.favouritedAt ?? 0)));
}

export function listAdded(space: Space): Promise<SongRow[]> {
  return db.songs
    .where('space')
    .equals(space)
    .filter((s) => s.kind !== 'generated' && s.favourite === 0)
    .toArray();
}
