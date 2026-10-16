import * as Tone from 'tone';
import type { Space } from '../recipes/schema';
import { Ambience, type AmbienceChoice, type AmbienceKind } from './ambience';
import type { FocusLevel, Song } from './types';
import { AudioLoopVoice, fadeIn, GeneratedVoice, WIND_DOWN_SECONDS, type LoopSettings, type Voice } from './voices';

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
  /** Epoch ms when the sleep timer ends playback, and the length it was set to. */
  sleepEndsAt: number | null;
  sleepMinutes: number | null;
  /** Ambience sounding now (with or without music). */
  ambience: { kind: AmbienceKind; space: Space } | null;
  rotation: Rotation | null;
  error: string | null;
}

/** Per-space listening options (see docs/music-and-concentration.md). */
export interface PlaybackProfile {
  /** Think only: arousal level of the music. */
  focus: FocusLevel;
  /** Think only: subtle 16 Hz amplitude modulation (beta range). */
  pulse: boolean;
  /** Steady nature sound or noise under (or instead of) the music. */
  ambience: AmbienceChoice;
  /** Sleep only: when the sleep timer ends, the music stops but the ambience plays on. */
  keepAmbience: boolean;
}

const DEFAULT_PROFILE: PlaybackProfile = { focus: 'balanced', pulse: false, ambience: 'off', keepAmbience: false };

/** A slow fade to silence at the end of the sleep timer (capped at half the timer). */
const SLEEP_FADE_SECONDS = 600;
/** Sleep music starts with this timer when none is set (trials played music for 30–45 minutes). */
export const DEFAULT_SLEEP_MINUTES = 45;
/** Breathing swell: about 6 a minute, easing to about 5 as the wind-down completes. */
const BREATH_HZ = [0.1, 0.08] as const;
/** About ±1.5 dB around unity, so switching it off leaves the level unchanged. */
const BREATH_DEPTH = 0.17;
/** A sleep session (for the wind-down) survives song changes and pauses shorter than this. */
const SLEEP_SESSION_GAP_MS = 15 * 60_000;
const PULSE_HZ = 16;
/** Gain after the leveller and pulse; calibrated so overall loudness matches the previous mix. */
const MAKEUP_DB = 14;
const PULSE_DEPTH = 0.2;

class Player {
  private state: PlayerState = {
    status: 'idle', current: null, volume: 0.8, sleepEndsAt: null, sleepMinutes: null, ambience: null, rotation: null, error: null,
  };
  private listeners = new Set<() => void>();
  private master: Tone.Gain | null = null;
  private sleepGain: Tone.Gain | null = null;
  private pulse: Tone.Tremolo | null = null;
  private breath: Tone.LFO | null = null;
  private ambienceVolume: Tone.Gain | null = null;
  private ambience: Ambience | null = null;
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
    // Sleep's breathing swell comes after the leveller, which would otherwise flatten it.
    const breath = new Tone.Gain(1);
    this.breath = new Tone.LFO({ frequency: BREATH_HZ[0], min: 1 - BREATH_DEPTH, max: 1 + BREATH_DEPTH, amplitude: 0 }).connect(breath.gain).start();
    const limiter = new Tone.Limiter(-1.5);
    this.master.chain(this.sleepGain, leveller, this.pulse, breath, makeup, limiter);
    // Ambience has its own path past the sleep fade and leveller, so it can play on alone at a steady level.
    this.ambienceVolume = new Tone.Gain(this.state.volume).connect(limiter);
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
    const wasPlaying = this.state.status === 'playing' || this.state.status === 'loading';
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
      this.applyAids(item.space, sessionElapsed);
      if (item.space === 'sleep' && !wasPlaying && !this.state.sleepEndsAt) this.setSleepTimer(DEFAULT_SLEEP_MINUTES);
      this.set({ status: 'playing' });
    } catch (e) {
      if (req === this.request) this.set({ status: 'idle', error: (e as Error).message });
    }
  }

  /** Pause the music, and the ambience too unless `keepAmbience`. */
  pause(fade = 1.5, opts: { keepAmbience?: boolean } = {}): void {
    if (!opts.keepAmbience) this.setAmbience(null, 'think', fade);
    if (!this.voice) return;
    this.request++;
    this.resumeAt = this.voice.position();
    this.voice.stop(fade);
    this.voice = null;
    this.set({ status: 'paused' });
    // Let the device rest while paused (matters overnight after the sleep timer), unless ambience plays on.
    const req = this.request;
    setTimeout(() => {
      if (req !== this.request || this.state.status !== 'paused' || this.ambience) return;
      this.mediaEl?.pause();
      void (Tone.getContext().rawContext as AudioContext).suspend?.();
    }, (fade + 1) * 1000);
  }

  /** Play a space's chosen ambience on its own, without music. */
  async startAmbience(space: Space): Promise<void> {
    const kind = this.profiles[space].ambience;
    if (kind === 'off') return;
    await this.graph();
    this.setAmbience(kind, space, 3);
  }

  stopAmbience(fade = 2): void {
    this.setAmbience(null, 'think', fade);
  }

  /** Media keys and the notification: whatever is sounding stops; otherwise the music resumes. */
  mediaToggle(): void {
    if (this.state.status === 'playing' || this.state.status === 'loading' || this.ambience) this.pause();
    else void this.resume();
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
    this.ambienceVolume?.gain.rampTo(volume, 0.1);
    this.set({ volume });
  }

  /** Fade out and pause after `minutes`; null cancels. */
  setSleepTimer(minutes: number | null): void {
    this.cancelSleepFade();
    this.sleepTimerSeconds = (minutes ?? 0) * 60;
    this.set({ sleepEndsAt: minutes ? Date.now() + minutes * 60_000 : null, sleepMinutes: minutes || null });
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
        // Even in decibels, so it sounds like a steady fade rather than a late drop.
        this.sleepFading = true;
        const g = this.sleepGain.gain;
        const t = Tone.now();
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(1e-3, g.value), t);
        g.exponentialRampToValueAtTime(Tone.dbToGain(-60), t + Math.max(1, remaining));
      }
      if (remaining <= 0) {
        // Already silent: stop instantly, then restore the gain for next time. Ambience may play on all night.
        this.pause(0.05, { keepAmbience: this.profiles.sleep.keepAmbience });
        this.set({ sleepEndsAt: null, sleepMinutes: null });
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
    const { current, status, ambience } = this.state;
    if (current?.space !== space || status !== 'playing') {
      // Ambience playing on its own follows its space's choice.
      if (ambience?.space === space) this.setAmbience(profile.ambience === 'off' ? null : profile.ambience, space, 2);
      return;
    }
    this.applyAids(space, this.sleepElapsed());
    if (profile.focus !== before.focus && current.kind === 'generated' && this.voice) {
      // Same song, new tempo and texture: pick up at the current bar.
      void this.play(current, { keepRotation: true, resume: this.voice.position(), fade: 3 });
    }
  }

  /** Seconds into the current sleep session, without starting one. */
  private sleepElapsed(): number {
    return this.sleepSessionStart === null ? 0 : (Date.now() - this.sleepSessionStart) / 1000;
  }

  private applyAids(space: Space, sleepElapsed: number): void {
    const profile = this.profiles[space];
    this.pulse?.depth.rampTo(space === 'think' && profile.pulse ? PULSE_DEPTH : 0, 1.5);
    if (this.breath) {
      // Sleep only: about 6 swells a minute, slowing towards 5 over the wind-down.
      this.breath.amplitude.rampTo(space === 'sleep' ? 1 : 0, 2);
      const progress = Math.min(1, sleepElapsed / WIND_DOWN_SECONDS);
      const f = this.breath.frequency;
      const t = Tone.now();
      f.cancelScheduledValues(t);
      f.setValueAtTime(BREATH_HZ[0] + (BREATH_HZ[1] - BREATH_HZ[0]) * progress, t);
      if (progress < 1) f.linearRampToValueAtTime(BREATH_HZ[1], t + (1 - progress) * WIND_DOWN_SECONDS);
    }
    this.setAmbience(profile.ambience === 'off' ? null : profile.ambience, space, 2);
  }

  private setAmbience(kind: AmbienceKind | null, space: Space, fade: number): void {
    const playing = this.ambience;
    if (playing && kind && playing.kind === kind && playing.space === space) return;
    playing?.stop(fade);
    this.ambience = null;
    if (kind && this.ambienceVolume) {
      this.ambience = new Ambience(kind, space);
      this.ambience.output.connect(this.ambienceVolume);
      this.ambience.start(fade);
    }
    this.set({ ambience: this.ambience ? { kind: this.ambience.kind, space } : null });
  }

  private cancelSleepFade(): void {
    this.sleepFading = false;
    const g = this.sleepGain?.gain;
    if (!g) return;
    const t = Tone.now();
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + 0.5);
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
