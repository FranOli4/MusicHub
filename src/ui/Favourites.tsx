import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { player } from '../engine/player';
import { styleLabel } from '../engine/styles';
import { db, type SongRow } from '../library/db';
import { copyToSpace, favourite, listAdded, listFavourites, removeSong, rename, toPlayable, unfavourite } from '../library/library';
import { encodeShareCode, makeAudioBundle, shareFile } from '../library/share';
import type { Space } from '../recipes/schema';
import { copyText, Sheet, toast } from './common';
import { playAllFavourites, updateSettings, usePlayer, useSettings } from './controller';
import { HeartIcon, MoreIcon, PauseIcon, PlayIcon } from './icons';

const other = (s: Space): Space => (s === 'think' ? 'sleep' : 'think');
const spaceName = (s: Space) => (s === 'think' ? 'Think' : 'Sleep');

function kindLabel(row: SongRow): string {
  if (row.kind === 'audio') return 'Audio file';
  const style = row.recipe ? styleLabel(row.recipe.style, row.space) : '';
  return row.kind === 'recipe' ? `AI recipe · ${style}` : style;
}

export function Favourites({ space }: { space: Space }) {
  const favourites = useLiveQuery(() => listFavourites(space), [space]);
  const added = useLiveQuery(() => listAdded(space), [space]);
  const settings = useSettings(space);
  const [menu, setMenu] = useState<SongRow | null>(null);

  if (!favourites) return null;

  return (
    <section className="list-view">
      <div className="list-head">
        <div>
          <h2>{spaceName(space)} favourites</h2>
          <p className="muted">{favourites.length ? `${favourites.length} song${favourites.length === 1 ? '' : 's'}` : 'Tap ♥ while a song plays to keep it here.'}</p>
        </div>
        {favourites.length > 0 && (
          <button className="btn primary" onClick={() => void playAllFavourites(space)}>
            <PlayIcon /> Play all
          </button>
        )}
      </div>

      {favourites.length > 1 && (
        <div className="rotation-opts">
          <label>
            <input type="checkbox" checked={settings.shuffle} onChange={(e) => updateSettings(space, { shuffle: e.target.checked })} /> Shuffle
          </label>
          <label>
            Change song every
            <select value={settings.minutes} onChange={(e) => updateSettings(space, { minutes: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <ul className="songs">
        {favourites.map((row) => (
          <SongItem key={row.id} row={row} onMenu={() => setMenu(row)} onPlay={() => void player.play(toPlayable(row))} />
        ))}
      </ul>

      {added && added.length > 0 && (
        <>
          <h3 className="section-title">My added songs</h3>
          <ul className="songs">
            {added.map((row) => (
              <SongItem key={row.id} row={row} onMenu={() => setMenu(row)} onPlay={() => void player.play(toPlayable(row))} />
            ))}
          </ul>
        </>
      )}

      {menu && <SongMenu row={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

function SongItem({ row, onPlay, onMenu }: { row: SongRow; onPlay: () => void; onMenu: () => void }) {
  const { current, status } = usePlayer();
  const isCurrent = current?.songId === row.id;
  const playing = isCurrent && status === 'playing';
  return (
    <li className={`song ${isCurrent ? 'current' : ''}`}>
      <button className="icon-btn small" onClick={() => (playing ? player.pause() : isCurrent ? void player.resume() : onPlay())} aria-label={playing ? 'Pause' : `Play ${row.title}`}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="song-text" onClick={onPlay}>
        <div className="song-title">{row.title}</div>
        <div className="song-meta">{kindLabel(row)}</div>
      </div>
      <button className="icon-btn small" onClick={onMenu} aria-label={`More options for ${row.title}`}>
        <MoreIcon />
      </button>
    </li>
  );
}

function SongMenu({ row, onClose }: { row: SongRow; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'code'>('menu');
  const [title, setTitle] = useState(row.title);
  const [code, setCode] = useState('');

  const share = async () => {
    if (row.kind === 'audio') {
      const audio = row.audioId ? await db.audio.get(row.audioId) : undefined;
      if (!audio) return toast('Audio file is missing');
      const bundle = makeAudioBundle({ title: row.title, space: row.space, loop: row.loop ?? { crossfade: 2 }, name: audio.name, type: audio.type }, audio.blob);
      const how = await shareFile(bundle, `${row.title.replace(/[^\w\- ]+/g, '').trim() || 'song'}.musichub`, row.title);
      toast(how === 'downloaded' ? 'Saved the .musichub file — send it to the other device' : 'Shared');
      return onClose();
    }
    setCode(encodeShareCode(row));
    setMode('code');
  };

  if (mode === 'rename') {
    return (
      <Sheet title="Rename" onClose={onClose}>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await rename(row.id, title);
            if (player.getState().current?.songId === row.id) player.annotate({ title: title.trim() || 'Untitled' });
            onClose();
          }}
        >
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={60} />
          <button className="btn primary" type="submit">Save</button>
        </form>
      </Sheet>
    );
  }

  if (mode === 'code') {
    return (
      <Sheet title="Share code" onClose={onClose}>
        <div className="stack">
          <p className="muted">Send this code (e.g. on WhatsApp). On the other device: Add song → Import a share code.</p>
          <textarea className="input code" readOnly value={code} rows={4} onFocus={(e) => e.target.select()} />
          <button className="btn primary" onClick={async () => toast((await copyText(code)) ? 'Code copied' : 'Select the code and copy it')}>Copy code</button>
          {'share' in navigator && (
            <button className="btn" onClick={() => navigator.share({ text: `MusicHub song “${row.title}”: ${code}` }).catch(() => {})}>Share…</button>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={row.title} onClose={onClose}>
      <div className="menu">
        <button onClick={() => setMode('rename')}>Rename</button>
        <button onClick={() => void share()}>{row.kind === 'audio' ? 'Share as file' : 'Share code'}</button>
        <button
          onClick={async () => {
            await copyToSpace(row.id, other(row.space));
            toast(`Copied to ${spaceName(other(row.space))} favourites`);
            onClose();
          }}
        >
          Copy to {spaceName(other(row.space))}
        </button>
        {row.favourite === 1 ? (
          <button onClick={async () => (await unfavourite(row.id), onClose())}>
            <HeartIcon /> Remove from favourites
          </button>
        ) : (
          <button onClick={async () => (await favourite(toPlayable(row)), onClose())}>
            <HeartIcon filled /> Add to favourites
          </button>
        )}
        {row.kind !== 'generated' && (
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Delete “${row.title}” from this device?`)) return;
              await removeSong(row.id);
              onClose();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </Sheet>
  );
}
