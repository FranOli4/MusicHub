import { useMemo, useState } from 'react';
import { player } from '../engine/player';
import { randomSeed } from '../engine/rng';
import { songStyleLabel } from '../engine/styles';
import { AudioLoopVoice } from '../engine/voices';
import { db } from '../library/db';
import { addAudio, addRecipe, saveGenerated, toPlayable } from '../library/library';
import { decodeShareCode, readAudioBundle } from '../library/share';
import { buildPrompt } from '../recipes/prompt';
import { parseRecipeText, type Recipe, type Space } from '../recipes/schema';
import { copyText, toast } from './common';

type Panel = 'ai' | 'audio' | 'import' | null;

export function AddSong({ space, onAdded }: { space: Space; onAdded: () => void }) {
  const [open, setOpen] = useState<Panel>('ai');
  return (
    <section className="add-view">
      <h2>Add a song to {space === 'sleep' ? 'Sleep' : 'Think'}</h2>
      <Card title="Ask an AI to compose one" hint="Copy a prompt into Claude or ChatGPT, paste the reply back" open={open === 'ai'} onToggle={() => setOpen(open === 'ai' ? null : 'ai')}>
        <AskAi space={space} onAdded={onAdded} />
      </Card>
      <Card title="Loop an audio file" hint="MP3, M4A, OGG or WAV from your device" open={open === 'audio'} onToggle={() => setOpen(open === 'audio' ? null : 'audio')}>
        <ImportAudio space={space} onAdded={onAdded} />
      </Card>
      <Card title="Import from the other device" hint="A share code or a .musichub file" open={open === 'import'} onToggle={() => setOpen(open === 'import' ? null : 'import')}>
        <ImportShared space={space} onAdded={onAdded} />
      </Card>
    </section>
  );
}

function Card({ title, hint, open, onToggle, children }: { title: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`card ${open ? 'open' : ''}`}>
      <button className="card-head" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{title}</strong>
          <span className="muted">{hint}</span>
        </span>
        <span className="chev" aria-hidden>{open ? '–' : '+'}</span>
      </button>
      {open && <div className="card-body">{children}</div>}
    </div>
  );
}

function AskAi({ space, onAdded }: { space: Space; onAdded: () => void }) {
  const [wish, setWish] = useState('');
  const [reply, setReply] = useState('');
  const prompt = useMemo(() => buildPrompt(space, wish), [space, wish]);
  const parsed = useMemo(() => (reply.trim() ? parseRecipeText(reply) : null), [reply]);
  const recipe: Recipe | null = parsed?.ok ? { ...parsed.recipe, space } : null;
  const [seed] = useState(randomSeed);

  return (
    <div className="stack">
      <label className="field">
        <span>1. What would you like? (optional)</span>
        <input
          className="input"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          placeholder={space === 'sleep' ? 'e.g. a gentle Celtic hymn-like piece in D' : 'e.g. a flowing Bach-style prelude in G major'}
        />
      </label>
      <div className="row">
        <button className="btn primary" onClick={async () => toast((await copyText(prompt)) ? 'Prompt copied — paste it into your AI chat' : 'Couldn’t copy; open “Show prompt” and copy it')}>
          2. Copy prompt
        </button>
        <details className="prompt-peek">
          <summary>Show prompt</summary>
          <textarea className="input code" readOnly rows={8} value={prompt} onFocus={(e) => e.target.select()} />
        </details>
      </div>
      <label className="field">
        <span>3. Paste the AI’s reply</span>
        <textarea className="input code" rows={6} value={reply} onChange={(e) => setReply(e.target.value)} placeholder='{ "version": 1, "name": … }' />
      </label>
      {parsed && !parsed.ok && (
        <div className="error">
          <strong>That recipe needs fixing.</strong> You can paste these errors back to the AI:
          <ul>
            {parsed.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      {recipe && (
        <div className="preview">
          <div>
            <div className="song-title">{recipe.name}</div>
            <div className="song-meta">{songStyleLabel(recipe.style, space)} · {recipe.key} {recipe.scale} · {recipe.tempo} BPM</div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void player.play({ kind: 'generated', title: recipe.name, space, song: { recipe, seed } })}>Preview</button>
            <button
              className="btn primary"
              onClick={async () => {
                const id = await addRecipe(space, recipe, seed);
                const row = await db.songs.get(id);
                if (row) void player.play(toPlayable(row));
                toast('Added to favourites');
                setReply('');
                onAdded();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportAudio({ space, onAdded }: { space: Space; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [crossfade, setCrossfade] = useState(2);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');

  const choose = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, ''));
    setCrossfade(/\.(wav|ogg|flac)$/i.test(f.name) ? 0 : 2);
    try {
      setDuration(await AudioLoopVoice.duration(f));
    } catch {
      setDuration(null);
      setError('This file can’t be decoded on this device. Try MP3 or M4A.');
    }
  };

  return (
    <div className="stack">
      <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac" onChange={(e) => void choose(e.target.files?.[0])} />
      {error && <p className="error">{error}</p>}
      {file && duration !== null && (
        <>
          <label className="field">
            <span>Title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </label>
          <label className="field">
            <span>Blend the loop point: {crossfade === 0 ? 'off (gapless)' : `${crossfade} s`}</span>
            <input type="range" min={0} max={6} step={0.5} value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} />
            <small className="muted">Length {Math.round(duration)} s. MP3s usually click at the loop point, so blending is on by default.</small>
          </label>
          <div className="row">
            <button className="btn" onClick={() => void player.play({ kind: 'audio', title: title || file.name, space, songId: '', loop: { crossfade }, load: async () => file })}>
              Preview
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                const id = await addAudio(space, title || file.name, file, file.name, { crossfade });
                const row = await db.songs.get(id);
                if (row) void player.play(toPlayable(row));
                toast('Added to favourites');
                setFile(null);
                onAdded();
              }}
            >
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ImportShared({ space, onAdded }: { space: Space; onAdded: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const importCode = async () => {
    setError('');
    try {
      const shared = decodeShareCode(code);
      const song = { recipe: { ...shared.recipe, space }, seed: shared.seed };
      const id = shared.kind === 'recipe' ? await addRecipe(space, song.recipe, song.seed) : await saveGenerated(space, shared.title, song, true);
      if (shared.kind === 'recipe' && shared.title !== shared.recipe.name) await db.songs.update(id, { title: shared.title });
      toast(`Added “${shared.title}”`);
      setCode('');
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importFile = async (f: File | undefined) => {
    setError('');
    if (!f) return;
    try {
      const { header, audio } = await readAudioBundle(f);
      await addAudio(space, header.title, audio, header.name, header.loop);
      toast(`Added “${header.title}”`);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <label className="field">
        <span>Share code</span>
        <textarea className="input code" rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="MH1:…" />
      </label>
      <button className="btn primary" disabled={!code.trim()} onClick={() => void importCode()}>Import code</button>
      <label className="field">
        <span>…or a .musichub file (for audio songs)</span>
        <input type="file" accept=".musichub,application/octet-stream" onChange={(e) => void importFile(e.target.files?.[0])} />
      </label>
      {error && <p className="error">{error}</p>}
      <small className="muted">Imported songs go into {space === 'sleep' ? 'Sleep' : 'Think'} favourites.</small>
    </div>
  );
}
