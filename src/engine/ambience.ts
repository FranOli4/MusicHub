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
const LEVEL_DB: Record<AmbienceKind, number> = { rain: -12, river: -16.5, ocean: -11.5, noise: -15.5 };
/** Peak level of the rain patter relative to the wash. */
const PATTER = 0.5;

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

  /** A steady wash plus a fine patter that fuses into texture rather than separate drops. */
  private rain(out: Tone.InputNode) {
    const top = this.space === 'sleep' ? 3000 : 5000;
    const drift = this.add(new Tone.Gain(1)).connect(out);
    this.add(new Tone.LFO({ frequency: 0.047, min: Tone.dbToGain(-1), max: Tone.dbToGain(1) })).connect(drift.gain);
    const lowpass = this.add(new Tone.Filter({ frequency: top, type: 'lowpass', rolloff: -24 })).connect(drift);
    const highpass = this.add(new Tone.Filter({ frequency: 300, type: 'highpass' })).connect(lowpass);
    this.add(new Tone.Noise('pink')).connect(highpass);

    // Patter: bright noise whose level follows a slow random signal, sharpened so it peaks only now and then.
    const patter = this.add(new Tone.Gain(0)).connect(drift);
    const band = this.add(new Tone.Filter({ frequency: top * 0.7, type: 'bandpass', Q: 0.8 })).connect(patter);
    this.add(new Tone.Noise('white')).connect(band);
    const shaper = this.add(new Tone.WaveShaper((x) => PATTER * x ** 4, 1024)).connect(patter.gain);
    // Lowpassed white noise is very quiet (about −33 dB), so lift it into the shaper's ±1 range.
    const lift = this.add(new Tone.Gain(25)).connect(shaper);
    const smooth = this.add(new Tone.Filter({ frequency: 35, type: 'lowpass', rolloff: -24 })).connect(lift);
    this.add(new Tone.Noise('white')).connect(smooth);
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
