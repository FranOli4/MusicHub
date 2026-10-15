import * as Tone from 'tone';
import type { InstrumentId } from '../recipes/schema';

// Sample sets live in public/samples (fetched by scripts/fetch-samples.mjs).
type SampleSet = 'piano' | 'violin' | 'cello' | 'contrabass' | 'harp' | 'harmonium';

const base = `${import.meta.env.BASE_URL}samples/`;
let manifest: Promise<Record<SampleSet, string[]>> | null = null;
const buffers = new Map<SampleSet, Promise<Map<string, Tone.ToneAudioBuffer>>>();

function getManifest() {
  manifest ??= fetch(`${base}manifest.json`).then((r) => {
    if (!r.ok) throw new Error('Sample manifest missing — run `npm run samples`');
    return r.json();
  });
  return manifest;
}

/** File names use "s" for sharps (Ds4); Tone wants "D#4". */
const toNote = (file: string) => file.replace('s', '#');

/** Decoded buffers are shared by every song, so switching songs is instant after first use. */
function loadSet(set: SampleSet): Promise<Map<string, Tone.ToneAudioBuffer>> {
  let p = buffers.get(set);
  if (!p) {
    p = getManifest().then(async (m) => {
      const entries = await Promise.all(
        m[set].map(async (file) => [toNote(file), await Tone.ToneAudioBuffer.fromUrl(`${base}${set}/${file}.mp3`)] as const),
      );
      return new Map(entries);
    });
    p.catch(() => buffers.delete(set));
    buffers.set(set, p);
  }
  return p;
}

const SETS_FOR: Partial<Record<InstrumentId, SampleSet[]>> = {
  piano: ['piano'],
  violin: ['violin'],
  strings: ['violin', 'cello'],
  cello: ['cello'],
  bass: ['contrabass'],
  pizz: ['harp'],
  harp: ['harp'],
  organ: ['harmonium'],
};

export async function preload(ids: Iterable<InstrumentId>): Promise<void> {
  const sets = new Set<SampleSet>();
  for (const id of ids) for (const s of SETS_FOR[id] ?? []) sets.add(s);
  await Promise.all([...sets].map(loadSet));
}

export interface Instrument {
  play(midi: number, seconds: number, time: number, velocity: number): void;
  dispose(): void;
}

function sampler(urls: Map<string, Tone.ToneAudioBuffer>, out: Tone.InputNode, opts: Partial<Tone.SamplerOptions>, gainDb: number): Instrument {
  const vol = new Tone.Volume(gainDb).connect(out);
  const s = new Tone.Sampler({ urls: Object.fromEntries(urls), ...opts }).connect(vol);
  return {
    play: (m, sec, time, v) => s.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), sec, time, v),
    dispose: () => {
      s.dispose();
      vol.dispose();
    },
  };
}

function synth(out: Tone.InputNode, opts: Record<string, any>, chain: Tone.ToneAudioNode[], gainDb: number): Instrument {
  const vol = new Tone.Volume(gainDb).connect(out);
  const nodes = [...chain, vol];
  const s = new Tone.PolySynth({ voice: Tone.Synth, maxPolyphony: 24, options: opts as Tone.SynthOptions });
  s.chain(...nodes);
  return {
    play: (m, sec, time, v) => s.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), sec, time, v),
    dispose: () => {
      s.dispose();
      nodes.forEach((n) => n.dispose());
    },
  };
}

/** Build one instrument wired into `out`. Samples must already be preloaded. */
export async function createInstrument(id: InstrumentId, out: Tone.InputNode): Promise<Instrument> {
  switch (id) {
    case 'piano':
      return sampler(await loadSet('piano'), out, { release: 1.4 }, -1);
    case 'violin':
      return sampler(await loadSet('violin'), out, { attack: 0.06, release: 0.7 }, -7);
    case 'cello':
      return sampler(await loadSet('cello'), out, { attack: 0.12, release: 1.2 }, -6);
    case 'bass':
      return sampler(await loadSet('contrabass'), out, { release: 0.6 }, -3);
    case 'harp':
      return sampler(await loadSet('harp'), out, { release: 1.6 }, -6);
    case 'organ':
      return sampler(await loadSet('harmonium'), out, { attack: 0.15, release: 0.9 }, -12);
    case 'pizz': {
      const filter = new Tone.Filter(2400, 'lowpass').connect(out);
      const inst = sampler(await loadSet('harp'), filter, { release: 0.25 }, -4);
      return { play: inst.play, dispose: () => (inst.dispose(), filter.dispose()) };
    }
    case 'strings': {
      // A section sound from violin + cello samples: slow bow attack, chorus for ensemble width.
      const [violin, cello] = await Promise.all([loadSet('violin'), loadSet('cello')]);
      const urls = new Map<string, Tone.ToneAudioBuffer>();
      for (const [n, b] of cello) if (Tone.Frequency(n).toMidi() < 60) urls.set(n, b);
      for (const [n, b] of violin) if (Tone.Frequency(n).toMidi() >= 60) urls.set(n, b);
      const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.5, wet: 0.35 }).start().connect(out);
      const inst = sampler(urls, chorus, { attack: 0.45, release: 2 }, -11);
      return { play: inst.play, dispose: () => (inst.dispose(), chorus.dispose()) };
    }
    case 'pad':
      return synth(
        out,
        {
          oscillator: { type: 'fattriangle', count: 3, spread: 18 },
          envelope: { attack: 1.8, decay: 0.6, sustain: 0.8, release: 3.5 },
        },
        [new Tone.Filter(1100, 'lowpass'), new Tone.Chorus({ frequency: 0.3, depth: 0.6, wet: 0.4 }).start()],
        -17,
      );
    case 'harpsichord':
      return synth(
        out,
        {
          oscillator: { type: 'pulse', width: 0.18 },
          envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.35 },
        },
        [new Tone.Filter(180, 'highpass'), new Tone.Filter(4800, 'lowpass')],
        -20,
      );
  }
}
