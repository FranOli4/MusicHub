import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ambienceLabel, SPACE_AMBIENCE } from '../engine/ambience';
import { effectiveTempo } from '../engine/composer';
import { player, type Playable } from '../engine/player';
import type { FocusLevel } from '../engine/types';
import { songStyleLabel, SPACE_STYLES, styleLabel, type StyleChoice } from '../engine/styles';
import { db } from '../library/db';
import { favourite, unfavourite } from '../library/library';
import type { Space } from '../recipes/schema';
import { minutesLeft, toast, useNow } from './common';
import { chooseAmbience, next, playNew, playOrPause, updateSettings, usePlayer, useSettings } from './controller';
import { FOCUS_INFO, FocusPicker } from './FocusPicker';
import { HeartIcon, NextIcon, PauseIcon, PlayIcon, SparkIcon } from './icons';

const SLEEP_TIMERS = [15, 30, 45, 60, 90];

function describe(item: Playable, focus: FocusLevel): string {
  if (item.kind === 'audio') return 'Your audio · looping';
  const r = item.song.recipe;
  return `${songStyleLabel(r.style, item.space)} · ${r.key} ${r.scale} · ${Math.round(effectiveTempo(r, focus))} BPM`;
}

export function NowPlaying({ space }: { space: Space }) {
  const state = usePlayer();
  const settings = useSettings(space);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const mine = state.current?.space === space ? state.current : null;
  const playing = !!mine && (state.status === 'playing' || state.status === 'loading');
  const row = useLiveQuery(() => (mine?.songId ? db.songs.get(mine.songId) : undefined), [mine?.songId]);
  const isFav = row?.favourite === 1;
  const rotation = mine ? state.rotation : null;
  /** Ambience playing on its own in this space (e.g. all night after the sleep timer). */
  const ambienceOnly = !playing && state.ambience?.space === space ? state.ambience : null;

  const toggleFavourite = async () => {
    if (!mine || busy) return;
    setBusy(true);
    try {
      if (isFav && row) {
        await unfavourite(row.id);
        if (row.kind === 'generated') player.annotate({ songId: undefined });
        toast('Removed from favourites');
      } else {
        const id = await favourite(mine);
        player.annotate({ songId: id });
        toast(`Saved to ${space === 'sleep' ? 'Sleep' : 'Think'} favourites`);
      }
    } catch {
      toast('Save this file from “Add song” first');
    } finally {
      setBusy(false);
    }
  };

  const chooseStyle = (style: StyleChoice) => {
    updateSettings(space, { style });
    void playNew(space, style);
  };

  return (
    <section className="now">
      <div className={`art ${playing ? 'alive' : ''}`} aria-hidden>
        <div className="ring r1" />
        <div className="ring r2" />
        <div className="ring r3" />
      </div>

      <div className="now-text">
        <h1 className="title">{mine?.title ?? (space === 'sleep' ? 'Ready for rest' : 'Ready to focus')}</h1>
        <p className="subtitle">
          {state.status === 'loading' && mine
            ? 'Tuning the strings…'
            : mine
              ? describe(mine, settings.focus)
              : 'Press play for music that never ends'}
        </p>
      </div>

      <div className="transport">
        <button className="icon-btn" onClick={toggleFavourite} disabled={!mine} aria-pressed={isFav} aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}>
          <HeartIcon filled={isFav} />
        </button>
        <button className="play-btn" onClick={() => void playOrPause(space)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon width={34} height={34} /> : <PlayIcon width={34} height={34} />}
        </button>
        <button className="icon-btn" onClick={() => void next()} aria-label={rotation ? 'Next favourite' : 'New song'}>
          {rotation ? <NextIcon /> : <SparkIcon />}
        </button>
      </div>

      {rotation && (
        <div className="banner">
          <span>
            Favourites {rotation.index + 1} of {rotation.items.length} · next in {minutesLeft(rotation.nextAt, now)}
          </span>
          <button className="btn ghost small" onClick={() => player.stopRotation()}>Stay on this one</button>
        </div>
      )}

      {ambienceOnly && (
        <div className="banner">
          <span>{ambienceLabel(ambienceOnly.kind, space)} is playing on its own</span>
          <button className="btn ghost small" onClick={() => player.stopAmbience()}>Stop</button>
        </div>
      )}

      {state.error && mine && <p className="error">Couldn’t play: {state.error}</p>}

      <div className="block">
        <div className="label">New song style</div>
        <div className="chips">
          {SPACE_STYLES[space].map((s) => (
            <button key={s} className={`chip ${settings.style === s ? 'on' : ''}`} onClick={() => chooseStyle(s)}>
              {styleLabel(s, space)}
            </button>
          ))}
          <button className={`chip ${settings.style === 'mix' ? 'on' : ''}`} onClick={() => chooseStyle('mix')}>
            Surprise me
          </button>
        </div>
        <button className="btn wide" onClick={() => void playNew(space)}>
          <SparkIcon /> New song
        </button>
      </div>

      {space === 'think' && (
        <div className="block">
          <div className="label">Focus level · {FOCUS_INFO[settings.focus].hint}</div>
          <FocusPicker />
        </div>
      )}

      {space === 'sleep' && (
        <div className="block">
          <div className="label">
            Sleep timer{state.sleepEndsAt ? ` · fades out in ${minutesLeft(state.sleepEndsAt, now)}` : ''}
          </div>
          <div className="chips">
            <button className={`chip ${!state.sleepEndsAt ? 'on' : ''}`} onClick={() => player.setSleepTimer(null)}>Off</button>
            {SLEEP_TIMERS.map((m) => (
              <button key={m} className={`chip ${state.sleepEndsAt && state.sleepMinutes === m ? 'on' : ''}`} onClick={() => (player.setSleepTimer(m), toast(`Music will fade out in ${m} minutes`))}>
                {m} min
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="block">
        <div className="label">Ambience</div>
        <div className="chips">
          <button className={`chip ${settings.ambience === 'off' ? 'on' : ''}`} onClick={() => void chooseAmbience(space, 'off')}>Off</button>
          {SPACE_AMBIENCE[space].map((a) => (
            <button key={a} className={`chip ${settings.ambience === a ? 'on' : ''}`} onClick={() => void chooseAmbience(space, a)}>
              {ambienceLabel(a, space)}
            </button>
          ))}
        </div>
      </div>

      <label className="block volume">
        <span className="label">Volume</span>
        <input type="range" min={0} max={1} step={0.01} value={state.volume} onChange={(e) => player.setVolume(Number(e.target.value))} />
      </label>
    </section>
  );
}
