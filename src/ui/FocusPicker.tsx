import { FOCUS_LEVELS, type FocusLevel } from '../engine/types';
import { updateSettings, useSettings } from './controller';

export const FOCUS_INFO: Record<FocusLevel, { label: string; hint: string }> = {
  deep: { label: 'Deep work', hint: 'Slower and sparser, for reading, writing and hard thinking.' },
  balanced: { label: 'Balanced', hint: 'Steady, moderate music for most work.' },
  routine: { label: 'Routine tasks', hint: 'Livelier, to keep you engaged with repetitive work.' },
};

/** Think's focus level as chips; changing it re-voices the current song at the same bar. */
export function FocusPicker() {
  const { focus } = useSettings('think');
  return (
    <div className="chips">
      {FOCUS_LEVELS.map((f) => (
        <button key={f} className={`chip ${focus === f ? 'on' : ''}`} onClick={() => updateSettings('think', { focus: f })}>
          {FOCUS_INFO[f].label}
        </button>
      ))}
    </div>
  );
}
