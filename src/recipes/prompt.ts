import type { Space } from './schema';

const STYLE_GUIDE = `Styles (pick one for "style"):
- "worship-piano": contemporary instrumental worship. Felt piano melody, broken-chord accompaniment, warm pad. Four-chord loops like I–V–vi–IV, IV–I–V–vi, with sus4/add9 colour.
- "worship-ambient": prayerful ambient worship. Long swelling pads, very sparse piano, soft cello. Slow harmonic rhythm.
- "mozart": Classical-era string serenade in the manner of Mozart's "Eine kleine Nachtmusik". Bright major keys, clear 8-bar periods (bar 4 ends on V, bar 8 on I), Alberti bass.
- "vivaldi": Baroque concerto in the manner of Vivaldi's "Four Seasons". Section A is the tutti ritornello; other sections are solo-violin episodes built on circle-of-fifths sequences (e.g. i–iv–VII–III–VI–iio–V–i). Minor keys are typical.
- "bach": Baroque keyboard prelude / aria in the manner of Bach (the C-major Prelude, the Goldberg Aria). A calm piano tune over an even broken-chord figure; descending basses and circle-of-fifths sequences.
- "handel": stately Baroque air or largo in the manner of Handel (the Water Music air, "Ombra mai fu"). Cantabile violin over a walking continuo bass and soft organ; sus4 cadences.
- "haydn": string-quartet andante in the manner of Haydn. First violin over legato inner voices and cello; clear periods, cadential I/5–V7–I, an occasional borrowed iv. Major keys.
- "schubert": piano impromptu in the manner of Schubert. A singing tune over flowing triplet arpeggios; warm colour chords like bVI, iii and vi. Major keys.
- "adagio": slow movement (Romanze / Largo). Cantabile violin over pizzicato and muted strings.`;

const SPACE_GUIDE: Record<Space, string> = {
  think: `This song is for THINKING / FOCUS: steady and pleasant, never distracting. Tempo 60–120 BPM, density 0.4–0.8, brightness 0.4–0.75, reverb 0.3–0.6.`,
  sleep: `This song is for SLEEPING: very calm, soft and warm, no sudden changes. Tempo 40–60 BPM, density 0.1–0.4, brightness 0.1–0.35, reverb 0.6–0.9.`,
};

const EXAMPLE = `{
  "version": 1,
  "name": "Be Still My Soul (Reflection)",
  "space": "sleep",
  "style": "worship-ambient",
  "key": "D",
  "scale": "major",
  "tempo": 48,
  "meter": 4,
  "sections": [
    { "name": "A", "progression": ["I", "Vsus4 V", "vi", "IVadd9"] },
    { "name": "B", "progression": ["IV", "I/3", "ii7", "Vsus4"] }
  ],
  "form": "AABA",
  "motif": { "steps": [0, 2, -1, -1], "rhythm": [2, 1, 1, 4] },
  "density": 0.25,
  "brightness": 0.2,
  "reverb": 0.8
}`;

/** The text to paste into Claude / ChatGPT. The reply is a recipe the app can play forever. */
export function buildPrompt(space: Space, wish: string): string {
  const request = wish.trim() || (space === 'sleep' ? 'a gentle song to fall asleep to' : 'a song to help me focus');
  return `You are composing a "song recipe" for MusicHub, an app that plays endlessly evolving instrumental music. The app's engine turns your recipe into music that loops and varies forever, so you describe harmony and character, not individual notes.

What I'd like: ${request}

${SPACE_GUIDE[space]}

The music must be either Christian instrumental worship or classical (Baroque, Classical-era or early-Romantic: Bach, Handel, Vivaldi, Haydn, Mozart, Schubert). Don't copy copyrighted songs; public-domain hymn tunes are fine as inspiration.

${STYLE_GUIDE}

Reply with ONLY a JSON object (no commentary) with these fields:
- "version": 1
- "name": a short evocative title
- "space": "${space}"
- "style": one of the styles above
- "key": one of C, C#, Db, D, Eb, E, F, F#, Gb, G, Ab, A, Bb, B
- "scale": "major" or "minor"
- "tempo": BPM (number)
- "meter": 3 or 4 (beats per bar)
- "sections": 1–6 sections, each { "name": a single capital letter, "progression": 1–16 bars }. Each bar is one roman-numeral chord ("I") or two chords sharing the bar ("IV V"). Chords are relative to the key's scale: uppercase = major, lowercase = minor, "o" = diminished (e.g. "viio"), optional suffix 7, maj7, add9, 9, sus2, sus4, optional inversion "/3" or "/5", optional "b" or "#" prefix (e.g. "bVII"). 8-bar progressions work best.
- "form": order of sections, e.g. "AABA" (only letters that exist in "sections")
- "motif" (optional): the melodic seed. "steps" are scale-step moves for each note (0 = repeat, 1 = up a step, -2 = down a third…); "rhythm" is each note's length in beats. Same number of entries, 2–16 notes, about 1–2 bars long.
- "instruments" (optional): up to 6 of piano, pad, strings, violin, cello, bass, pizz, harpsichord, harp, organ. Leave it out to use the style's ensemble.
- "density", "brightness", "reverb": numbers 0–1

Example of the format:
${EXAMPLE}`;
}
