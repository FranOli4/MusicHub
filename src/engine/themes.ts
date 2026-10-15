// Public-domain melodies that generated songs may quote. Each theme is written as
// semitone offsets from the tonic (null = rest) with durations in beats, together
// with the harmony it needs. Variation passes replace the quote with new melody
// over the same chords, so the tune comes and goes during long sessions.

export const THEME_IDS = ['amazing-grace', 'hymn-to-joy', 'eine-kleine'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface Theme {
  id: ThemeId;
  title: string;
  /** Section the theme is stated in. */
  section: string;
  meter: 3 | 4;
  /** [offset from tonic | null, beats] */
  notes: [number | null, number][];
  /** Progression covering the section (one entry per bar). */
  sections: { name: string; progression: string[] }[];
  form: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  // NEW BRITAIN ("Amazing Grace"), traditional American melody, 1829.
  // The pickup to bar 1 sits at the end of bar 16 so the section loops seamlessly.
  'amazing-grace': {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    section: 'A',
    meter: 3,
    notes: [
      [0, 2], [4, 0.5], [0, 0.5],
      [4, 2], [2, 1],
      [0, 2], [-3, 1],
      [-5, 2], [-5, 1],
      [0, 2], [4, 0.5], [0, 0.5],
      [4, 2], [2, 1],
      [7, 5], [4, 1],
      [7, 2], [4, 0.5], [0, 0.5],
      [4, 2], [2, 1],
      [0, 2], [-3, 1],
      [-5, 2], [-5, 1],
      [0, 2], [4, 0.5], [0, 0.5],
      [4, 2], [2, 1],
      [0, 5], [-5, 1],
    ],
    sections: [
      {
        name: 'A',
        progression: ['I', 'I V', 'IV', 'I', 'I', 'I V', 'V', 'V', 'I', 'I V', 'IV', 'I', 'I', 'I V', 'I', 'I'],
      },
    ],
    form: 'A',
  },
  // HYMN TO JOY (Beethoven, 1824), sung as "Joyful, Joyful, We Adore Thee".
  'hymn-to-joy': {
    id: 'hymn-to-joy',
    title: 'Joyful, Joyful',
    section: 'A',
    meter: 4,
    notes: [
      [4, 1], [4, 1], [5, 1], [7, 1],
      [7, 1], [5, 1], [4, 1], [2, 1],
      [0, 1], [0, 1], [2, 1], [4, 1],
      [4, 1.5], [2, 0.5], [2, 2],
      [4, 1], [4, 1], [5, 1], [7, 1],
      [7, 1], [5, 1], [4, 1], [2, 1],
      [0, 1], [0, 1], [2, 1], [4, 1],
      [2, 1.5], [0, 0.5], [0, 2],
    ],
    sections: [
      { name: 'A', progression: ['I', 'V7', 'I', 'I V', 'I', 'V7', 'I', 'V I'] },
      { name: 'B', progression: ['V I', 'V I', 'V', 'I V', 'I', 'V7', 'I', 'V I'] },
    ],
    form: 'AABA',
  },
  // Mozart, Serenade No. 13 "Eine kleine Nachtmusik" K. 525 (1787), opening four bars.
  'eine-kleine': {
    id: 'eine-kleine',
    title: 'Eine kleine Nachtmusik',
    section: 'A',
    meter: 4,
    notes: [
      [0, 1], [null, 0.5], [-5, 0.5], [0, 1], [null, 0.5], [-5, 0.5],
      [0, 0.5], [-5, 0.5], [0, 0.5], [4, 0.5], [7, 2],
      [5, 1], [null, 0.5], [2, 0.5], [5, 1], [null, 0.5], [2, 0.5],
      [5, 0.5], [2, 0.5], [-1, 0.5], [2, 0.5], [-5, 2],
    ],
    sections: [
      { name: 'A', progression: ['I', 'I', 'V7', 'V7', 'I', 'IV', 'V7', 'I'] },
      { name: 'B', progression: ['V', 'V7', 'I', 'I', 'ii', 'V7', 'I', 'V'] },
    ],
    form: 'AABA',
  },
};

export const themeBeats = (theme: Theme) => theme.notes.reduce((sum, [, d]) => sum + d, 0);
