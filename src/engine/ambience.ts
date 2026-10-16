import * as Tone from 'tone';
import type { Space } from '../recipes/schema';

// Steady nature sounds and noise, synthesised live (no recordings, so no loop seam).
// Kept steady and soft-topped: intermittent, sharp sounds are what wake sleepers
// (docs/music-and-concentration.md §9).

export type AmbienceKind = 'rain' | 'river' | 'ocean' | 'noise';
export type AmbienceChoice = AmbienceKind | 'off';

/** Ambience offered in each space, in display order. Ocean's slow swells suit Sleep only. */
export const SPACE_AMBIENCE: Record<Space, AmbienceKind[]> = {
  think: ['rain', 'river', 'noise'],
  sleep: ['rain', 'river', 'ocean', 'noise'],
};

export function ambienceLabel(kind: AmbienceKind, space: Space): string {
  if (kind === 'noise') return space === 'sleep' ? 'Brown noise' : 'Pink noise';
  return { rain: 'Rain', river: 'River', ocean: 'Ocean' }[kind];
}

/** Output level per sound, measured in the browser to sit about 15–18 dB under typical music. */
const LEVEL_DB: Record<AmbienceKind, number> = { rain: -12, river: -11, ocean: -11.5, noise: -15.5 };

export class Ambience {
  readonly output = new Tone.Gain(0);
  private readonly nodes: Tone.ToneAudioNode[] = [];
  private readonly sources: (Tone.Noise | Tone.LFO)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly kind: AmbienceKind,
    readonly space: Space,
  ) {
    // Think music is louder than Sleep, so its pink noise sits 3 dB higher to keep the same gap.
    const db = LEVEL_DB[kind] + (kind === 'noise' && space === 'think' ? 3 : 0);
    const level = new Tone.Gain(Tone.dbToGain(db)).connect(this.output);
    this.nodes.push(level);
    if (kind === 'rain') this.rain(level);
    else if (kind === 'river') this.river(level);
    else if (kind === 'ocean') this.ocean(level);
    else this.noise(level);
  }

  private add<T extends Tone.ToneAudioNode>(node: T): T {
    this.nodes.push(node);
    if (node instanceof Tone.Noise || node instanceof Tone.LFO) this.sources.push(node);
    return node;
  }

  /**
   * Three layers: a deep distant wash, a mid "sheet of rain" hiss, and many tiny individual
   * droplets (random timing, pitch and level) that give it the pattering realism of real rain.
   * Sleep keeps the droplets softer, darker and gentler-onset so they don't startle.
   */
  private rain(out: Tone.InputNode) {
    const sleep = this.space === 'sleep';
    const top = sleep ? 3500 : 6500;
    const drift = this.add(new Tone.Gain(1)).connect(out);
    this.add(new Tone.LFO({ frequency: 0.047, min: Tone.dbToGain(-1.5), max: Tone.dbToGain(1.5) })).connect(drift.gain);

    // Distant wash and low body.
    const wash = this.add(new Tone.Filter({ frequency: top, type: 'lowpass', rolloff: -24 })).connect(drift);
    const washHp = this.add(new Tone.Filter({ frequency: 200, type: 'highpass' })).connect(wash);
    this.add(new Tone.Noise('pink')).connect(washHp);
    const rumble = this.add(new Tone.Gain(0.35)).connect(drift);
    const rumbleLp = this.add(new Tone.Filter({ frequency: 350, type: 'lowpass', rolloff: -12 })).connect(rumble);
    this.add(new Tone.Noise('brown')).connect(rumbleLp);

    // Sheet hiss: broad band of white noise whose level slowly swells and fades like gusting rain.
    const sheet = this.add(new Tone.Gain(0.3)).connect(drift);
    this.add(new Tone.LFO({ frequency: 0.11, min: 0.15, max: 0.45, phase: Math.random() * 360 })).connect(sheet.gain);
    const sheetBp = this.add(new Tone.Filter({ frequency: sleep ? 2200 : 3800, type: 'bandpass', Q: 0.6 })).connect(sheet);
    this.add(new Tone.Noise('white')).connect(sheetBp);

    // Droplets: short enveloped noise bursts across a few lanes, scheduled slightly ahead.
    const LANES = 8;
    const lanes = Array.from({ length: LANES }, () => {
      const env = this.add(new Tone.AmplitudeEnvelope({
        attack: sleep ? 0.006 : 0.002, decay: 0.03, sustain: 0, release: 0.02,
      })).connect(drift);
      const bp = this.add(new Tone.Filter({ frequency: 3000, type: 'bandpass', Q: 1.4 })).connect(env);
      this.add(new Tone.Noise('white')).connect(bp);
      return { env, bp };
    });
    const rate = sleep ? 45 : 80; // drops per second
    const gain = sleep ? 0.5 : 0.75;
    const lo = sleep ? 700 : 900;
    const hi = sleep ? 3200 : 7500;
    const AHEAD = 0.25;
    let next = 0;
    let lane = 0;
    this.timer = setInterval(() => {
      const now = Tone.now();
      if (next < now) next = now;
      while (next < now + AHEAD) {
        next += -Math.log(1 - Math.random()) / rate; // Poisson spacing
        const l = lanes[lane++ % LANES];
        // Pitch skewed toward the lower end; level skewed toward quiet with the odd bigger drop.
        const f = lo * (hi / lo) ** (Math.random() ** 1.6);
        const v = gain * Math.random() ** 2.2;
        l.bp.frequency.setValueAtTime(f, next);
        l.env.decay = 0.015 + Math.random() * 0.035;
        l.env.triggerAttackRelease(0.004, next, v);
      }
    }, 100);
  }

  /** Brown noise through a few slowly wandering bands: a babbling flow. */
  private river(out: Tone.InputNode) {
    const lowpass = this.add(new Tone.Filter({ frequency: 2200, type: 'lowpass', rolloff: -24 })).connect(out);
    const bands: [number, number, number][] = [[0.07, 300, 700], [0.11, 500, 1100], [0.17, 800, 1500], [0.053, 250, 500]];
    const source = this.add(new Tone.Noise('pink'));
    for (const [rate, min, max] of bands) {
      const bp = this.add(new Tone.Filter({ frequency: (min + max) / 2, type: 'bandpass', Q: 1.6 })).connect(lowpass);
      this.add(new Tone.LFO({ frequency: rate, min, max, phase: Math.random() * 360 })).connect(bp.frequency);
      source.connect(bp);
    }
    const body = this.add(new Tone.Gain(0.6)).connect(lowpass);
    this.add(new Tone.Noise('brown')).connect(body);
  }

  /** Waves about every 9–12 s (near the 0.1 Hz breathing pace): level and brightness swell together. */
  private ocean(out: Tone.InputNode) {
    const swell = this.add(new Tone.Gain(0.5)).connect(out);
    const lowpass = this.add(new Tone.Filter({ frequency: 800, type: 'lowpass', rolloff: -24 })).connect(swell);
    this.add(new Tone.Noise('pink')).connect(lowpass);
    const wave = this.add(new Tone.LFO({ frequency: 0.095, min: 0, max: 1 }));
    wave.connect(this.add(new Tone.Scale(0.3, 1)).connect(swell.gain));
    wave.connect(this.add(new Tone.Scale(350, 1500)).connect(lowpass.frequency));
    // Each wave a little different: nudge the period now and then.
    this.timer = setInterval(() => wave.frequency.rampTo(0.083 + Math.random() * 0.028, 6), 11_000);
  }

  /** Plain colour noise: pink in Think, brown in Sleep; softly lowpassed so it sounds like air, not hiss. */
  private noise(out: Tone.InputNode) {
    const filter = this.add(new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 })).connect(out);
    this.add(new Tone.Noise(this.space === 'sleep' ? 'brown' : 'pink')).connect(filter);
  }

  start(fade: number): void {
    for (const s of this.sources) s.start();
    const now = Tone.now();
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(0, now);
    this.output.gain.linearRampToValueAtTime(1, now + Math.max(0.1, fade));
  }

  /** Fade out, then free everything. */
  stop(fade: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = Tone.now();
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
    setTimeout(() => {
      this.nodes.forEach((n) => n.dispose());
      this.output.dispose();
    }, (fade + 0.5) * 1000);
  }
}
