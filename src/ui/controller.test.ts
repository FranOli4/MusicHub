import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { migrateSettings, type SpaceSettings } from './controller';

describe('settings', () => {
  const base: SpaceSettings = { style: 'mix', minutes: 30, shuffle: true, focus: 'balanced', pulse: false, ambience: 'off', keepAmbience: false };

  it('turns the old noise-bed checkbox into the noise ambience', () => {
    expect(migrateSettings({ ...base, noise: true })).toEqual({ ...base, ambience: 'noise' });
    expect(migrateSettings({ ...base, noise: false })).toEqual(base);
    expect(migrateSettings({ ...base, noise: true, ambience: 'rain' }).ambience).toBe('rain');
  });
});
