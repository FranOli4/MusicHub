import * as Tone from 'tone';
import type { Space } from '../recipes/schema';
import type { FocusLevel, Song } from './types';
import { AudioLoopVoice, fadeIn, GeneratedVoice, type LoopSettings, type Voice } from './voices';

export type Playable =
  | { kind: 'generated'; title: string; space: Space; song: Song; songId?: string }
  | { kind: 'audio'; title: string; space: Space; songId: string; loop: LoopSettings; load: () => Promise<Blob> };

export interface Rotation {
  items: Playable[];
  index: number;
  minutes: number;
  /** Epoch ms when the next item starts. */
  nextAt: number;
}

export interface PlayerState {
  status: 'idle' | 'loading' | 'playing' | 'paused';
  current: Playable | null;
  volume: number;
  /** Epoch ms when the sleep timer ends playback. */
  sleepEndsAt: number | null;
  rotation: Rotation | null;
  error: string | null;
}

/** Per-space listening options (see docs/music-and-concentration.md). */
export interface PlaybackProfile {
  /** Think only: arousal level of the music. */
  focus: FocusLevel;
  /** Think only: subtle 16 Hz amplitude modulation (beta range). */
  pulse: boolean;
  /** Quiet noise bed under the music: pink in Think, brown in Sleep. */
  noise: boolean;
}

const DEFAULT_PROFILE: PlaybackProfile = { focus: 'balanced', pulse: false, noise: false };

/** A slow fade to silence at the end of the sleep timer (capped at half the timer). */
const SLEEP_FADE_SECONDS = 300;
/** A sleep session (for the wind-down) survives song changes and pauses shorter than this. */
const SLEEP_SESSION_GAP_MS = 15 * 60_000;
const PULSE_HZ = 16;
/** Gain after the leveller and pulse; calibrated so overall loudness matches the previous mix. */
const MAKEUP_DB = 14;
const PULSE_DEPTH = 0.2;
/** Noise bed gain per colour, measured to sit about 18 dB under the music (brown is denser). */
const NOISE_DB = { pink: -30, brown: -34 };

class Player {
  private state: PlayerState = { status: 'idle', current: null, volume: 0.8, sleepEndsAt: null, rotation: null, error: null };
  private listeners = new Set<() => void>();
  private master: Tone.Gain | null = null;
  private sleepGain: Tone.Gain | null = null;
  private pulse: Tone.Tremolo | null = null;
  private noise: Tone.Noise | null = null;
  private noiseGain: Tone.Gain | null = null;
  private noiseStop: ReturnType<typeof setTimeout> | null = null;
  private profiles: Record<Space, PlaybackProfile> = { think: DEFAULT_PROFILE, sleep: DEFAULT_PROFILE };
  private sleepSessionStart: number | null = null;
  private lastActive = 0;
  private sleepTimerSeconds = 0;
  private mediaEl: HTMLAudioElement | null = null;
  private voice: Voice | null = null;
  private resumeAt = 0;
  private request = 0;
  private sleepFading = false;
  private clock: ReturnType<typeof setInterval> | null = null;

  getState = (): PlayerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Master chain. Output goes through an <audio> element so the OS treats us as a media player. */
  private async graph(): Promise<Tone.Gain> {
    await Tone.start();
    if (this.master) {
      if (this.mediaEl?.paused) this.mediaEl.play().catch(() => {});
      return this.master;
    }
    this.master = new Tone.Gain(this.state.volume);
    this.sleepGain = new Tone.Gain(1);
    // Slow, gentle levelling keeps every style at a similar loudness without pumping.
    const leveller = new Tone.Compressor({ threshold: -42, ratio: 3, attack: 0.3, release: 1, knee: 12 });
    this.pulse = new Tone.Tremolo({ frequency: PULSE_HZ, depth: 0, spread: 0, type: 'sine' }).start();
    // Tone's Tremolo idles at half gain (it swings 0.5 ± depth/2), so +6 dB of the makeup undoes that.
    const makeup = new Tone.Gain(Tone.dbToGain(MAKEUP_DB));
    const limiter = new Tone.Limiter(-1.5);
    this.master.chain(this.sleepGain, leveller, this.pulse, makeup, limiter);
    // The noise bed joins at the master, so volume, the sleep fade and the leveller apply to it too.
    this.noiseGain = new Tone.Gain(0).connect(this.master);
    try {
      const raw = Tone.getContext().rawContext as AudioContext;
      const dest = raw.createMediaStreamDestination();
      Tone.connect(limiter, dest);
      const el = new Audio();
      el.srcObject = dest.stream;
      await el.play();
      this.mediaEl = el;
    } catch {
      limiter.toDestination();
    }
    this.clock ??= setInterval(() => this.onClock(), 1000);
    return this.master;
  }

  async play(item: Playable, opts: { fade?: number; keepRotation?: boolean; resume?: number } = {}): Promise<void> {
    const req = ++this.request;
    const fade = opts.fade ?? 2.5;
    this.set({
      status: 'loading',
      current: item,
      error: null,
      rotation: opts.keepRotation ? this.state.rotation : null,
    });
    try {
      const master = await this.graph();
      const profile = this.profiles[item.space];
      const sessionElapsed = this.sleepSession(item.space);
      const voice =
        item.kind === 'generated'
          ? await GeneratedVoice.create(item.song, master, opts.resume ?? 0, { focus: profile.focus, sessionElapsed })
          : await AudioLoopVoice.create(await item.load(), item.loop, master, opts.resume ?? 0);
      if (req !== this.request) {
        voice.stop(0);
        return;
      }
      this.voice?.stop(fade);
      this.voice = voice;
      const at = Tone.now() + 0.15;
      voice.start(at);
      fadeIn(voice, at, fade);
      this.applyAids(item.space);
      this.set({ status: 'playing' });
    } catch (e) {
      if (req === this.request) this.set({ status: 'idle', error: (e as Error).message });
    }
  }

  pause(fade = 1.5): void {
    if (!this.voice) return;
    this.request++;
    this.resumeAt = this.voice.position();
    this.voice.stop(fade);
    this.voice = null;
    this.setNoise(null, fade);
    this.set({ status: 'paused' });
    // Let the device rest while paused (matters overnight after the sleep timer).
    const req = this.request;
    setTimeout(() => {
      if (req !== this.request || this.state.status !== 'paused') return;
      this.mediaEl?.pause();
      void (Tone.getContext().rawContext as AudioContext).suspend?.();
    }, (fade + 1) * 1000);
  }

  /** Update details of the current item (e.g. its id once it has been favourited). */
  annotate(patch: Partial<Pick<Playable, 'songId' | 'title'>>): void {
    if (this.state.current) this.set({ current: { ...this.state.current, ...patch } as Playable });
  }

  async resume(): Promise<void> {
    const { current, rotation } = this.state;
    if (!current) return;
    if (rotation) this.set({ rotation: { ...rotation, nextAt: Date.now() + rotation.minutes * 60_000 } });
    await this.play(current, { keepRotation: true, resume: this.resumeAt });
  }

  toggle(): void {
    if (this.state.status === 'playing' || this.state.status === 'loading') this.pause();
    else void this.resume();
  }

  setVolume(volume: number): void {
    this.master?.gain.rampTo(volume, 0.1);
    this.set({ volume });
  }

  /** Fade out and pause after `minutes`; null cancels. */
  setSleepTimer(minutes: number | null): void {
    this.cancelSleepFade();
    this.sleepTimerSeconds = (minutes ?? 0) * 60;
    this.set({ sleepEndsAt: minutes ? Date.now() + minutes * 60_000 : null });
  }

  /** Play favourites one after another (shuffled or in order), switching every `minutes`. */
  async playRotation(items: Playable[], minutes: number, shuffle: boolean, startWith = 0): Promise<void> {
    if (!items.length) return;
    const order = shuffle ? shuffled(items) : [...items.slice(startWith), ...items.slice(0, startWith)];
    this.set({ rotation: { items: order, index: 0, minutes, nextAt: Date.now() + minutes * 60_000 } });
    await this.play(order[0], { keepRotation: true });
  }

  async next(): Promise<void> {
    const r = this.state.rotation;
    if (!r) return;
    const index = (r.index + 1) % r.items.length;
    this.set({ rotation: { ...r, index, nextAt: Date.now() + r.minutes * 60_000 } });
    await this.play(r.items[index], { keepRotation: true, fade: 6 });
  }

  stopRotation(): void {
    this.set({ rotation: null });
  }

  private onClock(): void {
    const { rotation, sleepEndsAt, status } = this.state;
    const now = Date.now();
    if (status === 'playing' && rotation && now >= rotation.nextAt) void this.next();
    if (status === 'playing') this.lastActive = now;
    if (sleepEndsAt) {
      const remaining = (sleepEndsAt - now) / 1000;
      const fadeLength = Math.min(SLEEP_FADE_SECONDS, this.sleepTimerSeconds / 2 || SLEEP_FADE_SECONDS);
      if (remaining <= fadeLength && !this.sleepFading && this.sleepGain) {
        this.sleepFading = true;
        this.sleepGain.gain.cancelScheduledValues(Tone.now());
        this.sleepGain.gain.rampTo(0, Math.max(1, remaining));
      }
      if (remaining <= 0) {
        // Already silent: stop instantly, then restore the gain for next time.
        this.pause(0.05);
        this.set({ sleepEndsAt: null });
        setTimeout(() => this.cancelSleepFade(), 1000);
      }
    }
  }

  /**
   * Seconds into the current sleep session. A session starts when Sleep music starts after a
   * long break, and carries on across song changes, so the wind-down doesn't restart.
   */
  private sleepSession(space: Space): number {
    const now = Date.now();
    if (space !== 'sleep') {
      this.sleepSessionStart = null;
      return 0;
    }
    if (this.sleepSessionStart === null || now - this.lastActive > SLEEP_SESSION_GAP_MS) this.sleepSessionStart = now;
    this.lastActive = now;
    return (now - this.sleepSessionStart) / 1000;
  }

  /** Listening options for a space; applied live when that space is playing. */
  setProfile(space: Space, profile: PlaybackProfile): void {
    const before = this.profiles[space];
    this.profiles[space] = profile;
    const { current, status } = this.state;
    if (current?.space !== space || status !== 'playing') return;
    this.applyAids(space);
    if (profile.focus !== before.focus && current.kind === 'generated' && this.voice) {
      // Same song, new tempo and texture: pick up at the current bar.
      void this.play(current, { keepRotation: true, resume: this.voice.position(), fade: 3 });
    }
  }

  private applyAids(space: Space): void {
    const profile = this.profiles[space];
    this.pulse?.depth.rampTo(space === 'think' && profile.pulse ? PULSE_DEPTH : 0, 1.5);
    this.setNoise(profile.noise ? (space === 'sleep' ? 'brown' : 'pink') : null, 2);
  }

  private setNoise(type: 'pink' | 'brown' | null, fade: number): void {
    if (!this.noiseGain) return;
    if (this.noiseStop) clearTimeout(this.noiseStop);
    this.noiseStop = null;
    if (!type) {
      this.noiseGain.gain.rampTo(0, Math.max(0.1, fade));
      this.noiseStop = setTimeout(() => {
        this.noise?.stop();
      }, (fade + 0.5) * 1000);
      return;
    }
    if (!this.noise) {
      // Brown noise is already dark; pink gets a soft lowpass so it sounds like distant air, not hiss.
      const filter = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 }).connect(this.noiseGain);
      this.noise = new Tone.Noise(type).connect(filter);
    }
    this.noise.type = type;
    if (this.noise.state !== 'started') this.noise.start();
    this.noiseGain.gain.rampTo(Tone.dbToGain(NOISE_DB[type]), Math.max(0.1, fade));
  }

  private cancelSleepFade(): void {
    this.sleepFading = false;
    this.sleepGain?.gain.cancelScheduledValues(Tone.now());
    this.sleepGain?.gain.rampTo(1, 0.5);
  }
}

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const player = new Player();
