import * as Tone from 'tone';
import type { InstrumentId } from '../recipes/schema';
import { Composer } from './composer';
import { createInstrument, preload, type Instrument } from './instruments';
import { resolveInstruments } from './styles';
import type { Song } from './types';

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

export class GeneratedVoice implements Voice {
  readonly output = new Tone.Gain(0);
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBar: number;
  private nextBarTime = 0;
  private readonly startBar: number;
  private startTime = 0;

  private constructor(
    private readonly composer: Composer,
    private readonly instruments: Map<InstrumentId, Instrument>,
    private readonly nodes: Tone.ToneAudioNode[],
    startBar: number,
  ) {
    this.nextBar = startBar;
    this.startBar = startBar;
  }

  static async create(song: Song, destination: Tone.InputNode, startBar = 0): Promise<GeneratedVoice> {
    const { recipe } = song;
    const { roles, sound } = resolveInstruments(recipe);
    await preload(roles.map((r) => sound.get(r)!));
    const sleep = recipe.space === 'sleep';
    const cutoff = (sleep ? 1400 : 2600) + recipe.brightness * (sleep ? 3000 : 9000);
    const filter = new Tone.Filter({ frequency: cutoff, type: 'lowpass', rolloff: -12 });
    const reverb = new Tone.Reverb({ decay: 2.5 + recipe.reverb * 6, wet: 0.15 + recipe.reverb * 0.45, preDelay: 0.03 });
    await reverb.ready;
    const bus = new Tone.Gain(1);
    bus.chain(filter, reverb);
    const instruments = new Map<InstrumentId, Instrument>();
    for (const role of roles) instruments.set(role, await createInstrument(sound.get(role)!, bus));
    const voice = new GeneratedVoice(new Composer(song), instruments, [bus, filter, reverb], startBar);
    reverb.connect(voice.output);
    voice.output.connect(destination);
    return voice;
  }

  start(at: number): void {
    this.startTime = at;
    this.nextBarTime = at;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const horizon = Tone.now() + lookahead();
    const beat = 60 / this.composer.recipe.tempo;
    const barSeconds = this.composer.barSeconds;
    while (this.nextBarTime < horizon) {
      const bar = this.composer.bar(this.nextBar);
      for (const e of bar.events) {
        this.instruments.get(e.i)?.play(e.m, e.d * beat, this.nextBarTime + e.t * beat, e.v);
      }
      this.nextBar++;
      this.nextBarTime += barSeconds;
    }
  }

  position(): number {
    const elapsed = Math.max(0, Tone.now() - this.startTime);
    return this.startBar + Math.floor(elapsed / this.composer.barSeconds) + 1;
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
