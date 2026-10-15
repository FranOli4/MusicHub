import LZString from 'lz-string';
import type { LoopSettings } from '../engine/voices';
import { SPACES, validateRecipe, type Recipe, type Space } from '../recipes/schema';
import type { SongRow } from './db';

// Generated and recipe songs travel as a short text code (paste it in WhatsApp).
// Audio songs travel as a .musichub file: magic, header length, JSON header, raw audio bytes.

const PREFIX = 'MH1:';

interface CodePayload {
  t: string;
  s: Space;
  k: 'g' | 'r';
  r: Recipe;
  d: number;
}

export interface SharedSong {
  title: string;
  space: Space;
  kind: 'generated' | 'recipe';
  recipe: Recipe;
  seed: number;
}

export function encodeShareCode(row: SongRow): string {
  if (row.kind === 'audio' || !row.recipe || row.seed === undefined) throw new Error('Audio songs are shared as a file');
  const payload: CodePayload = { t: row.title, s: row.space, k: row.kind === 'recipe' ? 'r' : 'g', r: row.recipe, d: row.seed };
  return PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeShareCode(text: string): SharedSong {
  const match = /MH1:([A-Za-z0-9+\-_$]+)/.exec(text.replace(/\s+/g, ''));
  if (!match) throw new Error('That doesn’t look like a MusicHub code (it starts with MH1:)');
  const json = LZString.decompressFromEncodedURIComponent(match[1]);
  if (!json) throw new Error('The code is incomplete — copy the whole thing');
  let p: CodePayload;
  try {
    p = JSON.parse(json);
  } catch {
    throw new Error('The code is damaged');
  }
  const check = validateRecipe(p.r);
  if (!check.ok) throw new Error(`The code’s song is invalid: ${check.errors[0]}`);
  if (!SPACES.includes(p.s) || !Number.isFinite(p.d)) throw new Error('The code is damaged');
  return { title: String(p.t).slice(0, 80), space: p.s, kind: p.k === 'r' ? 'recipe' : 'generated', recipe: check.recipe, seed: p.d >>> 0 };
}

const MAGIC = 'MUSICHUB';

export interface AudioBundleHeader {
  v: 1;
  title: string;
  space: Space;
  loop: LoopSettings;
  name: string;
  type: string;
}

export function makeAudioBundle(header: Omit<AudioBundleHeader, 'v'>, audio: Blob): Blob {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, ...header }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length);
  return new Blob([MAGIC, len, json, audio], { type: 'application/octet-stream' });
}

export async function readAudioBundle(file: Blob): Promise<{ header: AudioBundleHeader; audio: Blob }> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) throw new Error('Not a .musichub file');
  const len = new DataView(head.buffer).getUint32(8);
  if (len > 64 * 1024) throw new Error('The .musichub file is damaged');
  const header = JSON.parse(await file.slice(12, 12 + len).text()) as AudioBundleHeader;
  if (header.v !== 1 || !SPACES.includes(header.space)) throw new Error('Unsupported .musichub file');
  const audio = file.slice(12 + len, file.size, header.type || 'audio/mpeg');
  return { header, audio };
}

/** Share via the OS share sheet when possible (phones), otherwise download the file. */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
