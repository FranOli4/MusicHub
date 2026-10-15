import Dexie, { type Table } from 'dexie';
import type { LoopSettings } from '../engine/voices';
import type { Recipe, Space } from '../recipes/schema';

export type SongKind = 'generated' | 'recipe' | 'audio';

export interface SongRow {
  id: string;
  space: Space;
  kind: SongKind;
  title: string;
  /** generated + recipe songs */
  recipe?: Recipe;
  seed?: number;
  /** audio songs */
  audioId?: string;
  loop?: LoopSettings;
  /** 1 = favourite (numeric so it can be indexed). */
  favourite: 0 | 1;
  createdAt: number;
  favouritedAt?: number;
}

export interface AudioRow {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

class MusicDb extends Dexie {
  songs!: Table<SongRow, string>;
  audio!: Table<AudioRow, string>;

  constructor(name = 'musichub') {
    super(name);
    this.version(1).stores({
      songs: 'id, space, [space+favourite], createdAt',
      audio: 'id',
    });
  }
}

export const db = new MusicDb();

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
