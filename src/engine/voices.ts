import * as Tone from 'tone';
import type { InstrumentId, StyleId } from '../recipes/schema';
import { Composer, effectiveTempo } from './composer';
import { createInstrument, preload, type Instrument } from './instruments';
import { resolveInstruments } from './styles';
import type { FocusLevel, Song } from './types';

/** Something that plays forever into its own output gain until stopped. */
export interface Voice {
  readonly output: Tone.Gain;
  start(at: number): void;
  /** Fade out over `fade` seconds, then free resources. */
  stop(fade: number): void;
  /** Where to resume from after a pause. */
  position(): number;
}

/** Schedule this far ahead; much further when the page is hidden (timers get throttled). */
const lookahead = () => (typeof document !== 'undefined' && document.hidden ? 30 : 4);
const TICK_MS = 250;

/**
 * Loudness trims per style, measured in the browser (RMS at the master input), so every style
 * plays at about the same level. Sparse worship textures need a lift; dense string writing a cut.
 */
const STYLE_TRIM_DB: Record<StyleId, number> = {
  'worship-piano': 4,
  'worship-ambient': 4,
  mozart: -2,
  vivaldi: -2,
  bach: 1,
  handel: -2,
  haydn: 1,
  schubert: 5,
  adagio: 1,
};

/** Sleep winds down (slower, sparser, softer, darker) over this long. */
export const WIND_DOWN_SECONDS = 30 * 60;

export interface GeneratedOptions {
  focus?: FocusLevel;
  /** Seconds of the current sleep session already played when this voice starts. */
  sessionElapsed?: number;
}

export class GeneratedVoice implements Voice {
  readonly output = new Tone.Gain(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar: number;
  private nextBarTime = 0;
  /** Recent [bar, start time] pairs, for resuming at the right bar when tempo varies. */
  private barTimes: [number, number][] = [];

  private constructor(
    private readonly composer: Composer,
    private readonly instruments: Map<InstrumentId, Instrument>,
    private readonly nodes: Tone.ToneAudioNode[],
    private readonly filter: Tone.Filter,
    private readonly cutoff: number,
    private readonly windDownAt: (bar: number) => number,
    private readonly startBar: number,
  ) {
    this.nextBar = startBar;
  }

  static async create(song: Song, destination: Tone.InputNode, startBar = 0, opts: GeneratedOptions = {}): Promise<GeneratedVoice> {
    const { recipe } = song;
    const { roles, sound } = resolveInstruments(recipe);
    await preload(roles.map((r) => sound.get(r)!));
    const sleep = recipe.space === 'sleep';
    // Think rolls off above ~9 kHz plus a gentle high shelf (less sharpness); Sleep is much darker.
    const cutoff = sleep ? 1400 + recipe.brightness * 3000 : 3000 + recipe.brightness * 6000;
    const filter = new Tone.Filter({ frequency: cutoff, type: 'lowpass', rolloff: -12 });
    const shelf = new Tone.Filter({ frequency: 4000, type: 'highshelf', gain: sleep ? 0 : -3 });
    const reverb = new Tone.Reverb(
      sleep
        ? { decay: 3 + recipe.reverb * 3, wet: 0.25 + recipe.reverb * 0.45, preDelay: 0.03 }
        : { decay: 1.8 + recipe.reverb * 2.5, wet: 0.15 + recipe.reverb * 0.4, preDelay: 0.02 },
    );
    await reverb.ready;
    const bus = new Tone.Gain(1);
    const trim = new Tone.Gain(Tone.dbToGain(STYLE_TRIM_DB[recipe.style]));
    bus.chain(filter, shelf, reverb, trim);
    const instruments = new Map<InstrumentId, Instrument>();
    for (const role of roles) instruments.set(role, await createInstrument(sound.get(role)!, bus, recipe.space));

    // Wind-down progress by bar, measured from the start of the sleep session (not of this song).
    const elapsed0 = opts.sessionElapsed ?? 0;
    const base = (60 / effectiveTempo(recipe, opts.focus)) * recipe.meter;
    const windDown = (bar: number) => Math.min(1, Math.max(0, (elapsed0 + (bar - startBar) * base) / WIND_DOWN_SECONDS));
    const composer = new Composer(song, { focus: opts.focus, windDown: sleep ? windDown : undefined });
    const voice = new GeneratedVoice(composer, instruments, [bus, filter, shelf, reverb, trim], filter, cutoff, sleep ? windDown : () => 0, startBar);
    trim.connect(voice.output);
    voice.output.connect(destination);
    return voice;
  }

  start(at: number): void {
    this.nextBarTime = at;
    if (this.composer.recipe.space === 'sleep') {
      // Darken gradually, to 70% of the cutoff by the end of the wind-down.
      const w = this.windDownAt(this.startBar);
      const f = this.filter.frequency;
      f.setValueAtTime(this.cutoff * (1 - 0.3 * w), at);
      if (w < 1) f.linearRampToValueAtTime(this.cutoff * 0.7, at + (1 - w) * WIND_DOWN_SECONDS);
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const horizon = Tone.now() + lookahead();
    const meter = this.composer.recipe.meter;
    while (this.nextBarTime < horizon) {
      const barSeconds = this.composer.barSecondsAt(this.nextBar);
      const beat = barSeconds / meter;
      const bar = this.composer.bar(this.nextBar);
      for (const e of bar.events) {
        this.instruments.get(e.i)?.play(e.m, e.d * beat, this.nextBarTime + e.t * beat, e.v);
      }
      this.barTimes.push([this.nextBar, this.nextBarTime]);
      if (this.barTimes.length > 64) this.barTimes.shift();
      this.nextBar++;
      this.nextBarTime += barSeconds;
    }
  }

  /** The bar after the one sounding now. */
  position(): number {
    const now = Tone.now();
    let bar = this.startBar - 1;
    for (const [b, t] of this.barTimes) if (t <= now) bar = b;
    return bar + 1;
  }

  stop(fade: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = Tone.now();
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      this.instruments.forEach((i) => i.dispose());
      this.nodes.forEach((n) => n.dispose());
      this.output.dispose();
    }, (fade + 0.5) * 1000);
  }
}

export interface LoopSettings {
  /** Seconds; defaults to the whole file. */
  loopStart?: number;
  loopEnd?: number;
  /** Seconds of overlap at the loop point; 0 = sample-accurate gapless loop. */
  crossfade: number;
}

/** Loops an imported audio file forever, optionally crossfading at the loop point. */
export class AudioLoopVoice implements Voice {
  readonly output = new Tone.Gain(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sources: Tone.ToneBufferSource[] = [];
  private player: Tone.Player | null = null;
  private nextAt = 0;
  private first = true;
  private startTime = 0;
  private readonly start0: number;
  private readonly end: number;

  private constructor(
    private readonly buffer: Tone.ToneAudioBuffer,
    private readonly settings: LoopSettings,
    private readonly resumeOffset: number,
  ) {
    this.start0 = Math.max(0, settings.loopStart ?? 0);
    this.end = Math.min(buffer.duration, settings.loopEnd ?? buffer.duration);
  }

  static async create(data: Blob | ArrayBuffer, settings: LoopSettings, destination: Tone.InputNode, resumeOffset = 0): Promise<AudioLoopVoice> {
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
    const decoded = await Tone.getContext().decodeAudioData(bytes);
    const voice = new AudioLoopVoice(new Tone.ToneAudioBuffer(decoded), settings, resumeOffset);
    voice.output.connect(destination);
    return voice;
  }

  static async duration(data: Blob): Promise<number> {
    const decoded = await Tone.getContext().decodeAudioData(await data.arrayBuffer());
    return decoded.duration;
  }

  private get length() {
    return Math.max(0.5, this.end - this.start0);
  }

  start(at: number): void {
    this.startTime = at;
    const xf = Math.min(this.settings.crossfade, this.length / 3);
    if (xf <= 0.01) {
      this.player = new Tone.Player({ url: this.buffer, loop: true, loopStart: this.start0, loopEnd: this.end, fadeIn: 0.05 });
      this.player.connect(this.output).start(at, this.start0 + (this.resumeOffset % this.length));
      return;
    }
    this.nextAt = at;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const xf = Math.min(this.settings.crossfade, this.length / 3);
    const horizon = Tone.now() + lookahead();
    while (this.nextAt < horizon) {
      const offset = this.first ? this.resumeOffset % this.length : 0;
      const playFor = this.length - xf - offset;
      const src = new Tone.ToneBufferSource({ url: this.buffer, fadeIn: this.first ? 0.05 : xf, fadeOut: xf, curve: 'linear' });
      src.connect(this.output).start(this.nextAt, this.start0 + offset, Math.max(0.1, playFor));
      src.onended = () => {
        this.sources = this.sources.filter((s) => s !== src);
        src.dispose();
      };
      this.sources.push(src);
      this.nextAt += Math.max(0.1, playFor);
      this.first = false;
    }
  }

  position(): number {
    return this.resumeOffset + Math.max(0, Tone.now() - this.startTime);
  }

  stop(fade: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = Tone.now();
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      this.player?.dispose();
      this.sources.forEach((s) => s.dispose());
      this.output.dispose();
    }, (fade + 0.5) * 1000);
  }
}

/** Fade a freshly started voice in. */
export function fadeIn(voice: Voice, at: number, seconds: number): void {
  voice.output.gain.setValueAtTime(0, at);
  voice.output.gain.linearRampToValueAtTime(1, at + Math.max(0.05, seconds));
}
