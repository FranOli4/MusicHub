import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { newSong } from '../engine/styles';
import { buildPrompt } from '../recipes/prompt';
import { parseRecipeText } from '../recipes/schema';
import { db } from './db';
import { addAudio, addRecipe, copyToSpace, favourite, listAdded, listFavourites, removeSong, saveGenerated, toPlayable, unfavourite } from './library';
import { decodeShareCode, encodeShareCode, makeAudioBundle, readAudioBundle } from './share';

beforeEach(async () => {
  await db.songs.clear();
  await db.audio.clear();
});

describe('recipes from an LLM', () => {
  it('accepts a reply wrapped in prose and code fences', () => {
    const reply = 'Sure! Here it is:\n```json\n' + JSON.stringify(newSong('sleep', 'adagio', 5).recipe) + '\n```\nEnjoy.';
    const parsed = parseRecipeText(reply);
    expect(parsed.ok).toBe(true);
  });

  it('explains what is wrong', () => {
    const parsed = parseRecipeText('{"name":"x","space":"think","style":"jazz"}');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toMatch(/style/);
  });

  it('prompt names the space and the wish', () => {
    const p = buildPrompt('sleep', 'a hymn in D');
    expect(p).toContain('a hymn in D');
    expect(p).toContain('"space": "sleep"');
  });
});

describe('share codes', () => {
  it('round-trips a generated favourite', async () => {
    const song = newSong('think', 'vivaldi', 77);
    const id = await saveGenerated('think', 'My concerto', song, true);
    const code = encodeShareCode((await db.songs.get(id))!);
    expect(code.startsWith('MH1:')).toBe(true);
    expect(code.length).toBeLessThan(1200);
    const shared = decodeShareCode(`Here's a song: ${code} 🙂`);
    expect(shared).toMatchObject({ title: 'My concerto', space: 'think', kind: 'generated', seed: 77 });
    expect(shared.recipe).toEqual(song.recipe);
  });

  it('rejects damaged codes', () => {
    expect(() => decodeShareCode('hello')).toThrow(/MH1/);
    expect(() => decodeShareCode('MH1:abc')).toThrow();
  });

  it('round-trips an audio bundle', async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/mpeg' });
    const bundle = makeAudioBundle({ title: 'Rain', space: 'sleep', loop: { crossfade: 3 }, name: 'rain.mp3', type: 'audio/mpeg' }, audio);
    const { header, audio: out } = await readAudioBundle(bundle);
    expect(header).toMatchObject({ title: 'Rain', space: 'sleep', loop: { crossfade: 3 } });
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});

describe('library', () => {
  it('keeps Think and Sleep favourites separate', async () => {
    const s = newSong('sleep', 'worship-ambient', 1);
    await favourite({ kind: 'generated', title: 'Night', space: 'sleep', song: s });
    expect(await listFavourites('sleep')).toHaveLength(1);
    expect(await listFavourites('think')).toHaveLength(0);
  });

  it('copies between spaces and plays with the new space’s profile', async () => {
    const id = await saveGenerated('sleep', 'Night', newSong('sleep', 'adagio', 2), true);
    await copyToSpace(id, 'think');
    const [copy] = await listFavourites('think');
    expect(copy.title).toBe('Night');
    const playable = toPlayable(copy);
    expect(playable.kind === 'generated' && playable.song.recipe.space).toBe('think');
  });

  it('un-favouriting removes generated songs but keeps added ones', async () => {
    const gen = await saveGenerated('think', 'Gen', newSong('think', 'mozart', 3), true);
    const rec = await addRecipe('think', newSong('think', 'mozart', 4).recipe);
    await unfavourite(gen);
    await unfavourite(rec);
    expect(await db.songs.get(gen)).toBeUndefined();
    expect((await listAdded('think')).map((r) => r.id)).toEqual([rec]);
  });

  it('only deletes shared audio data when the last song using it is removed', async () => {
    const id = await addAudio('sleep', 'Rain', new Blob([new Uint8Array([9])]), 'rain.mp3', { crossfade: 2 });
    await copyToSpace(id, 'think');
    expect(await db.audio.count()).toBe(1);
    await removeSong(id);
    expect(await db.audio.count()).toBe(1);
    const [copy] = await listFavourites('think');
    await removeSong(copy.id);
    expect(await db.audio.count()).toBe(0);
  });
});
