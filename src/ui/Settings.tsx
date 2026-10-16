import { updateSettings, useSettings } from './controller';

/** One settings page for both spaces. Kept short on purpose; everyday controls live on the Playing screen. */
export function Settings() {
  const think = useSettings('think');
  const sleep = useSettings('sleep');
  return (
    <section className="settings-view">
      <h2>Settings</h2>
      <div className="card open">
        <div className="card-body stack">
          <label className="check multi">
            <input type="checkbox" checked={sleep.keepAmbience} onChange={(e) => updateSettings('sleep', { keepAmbience: e.target.checked })} />
            <span>
              Keep ambience playing all night
              <span className="sub">
                When the sleep timer ends, the music fades but the rain, river, ocean or noise keeps going, so night-time sounds are less likely
                to wake you. Choose the sound under Ambience on the Sleep screen. Keep it quiet enough that you still hear your child.
              </span>
            </span>
          </label>
          <label className="check multi">
            <input type="checkbox" checked={think.pulse} onChange={(e) => updateSettings('think', { pulse: e.target.checked })} />
            <span>
              Focus pulse
              <span className="sub">
                Think only: a faint, fast (16 Hz, beta-range) ripple in the volume. One 2024 study found it may help ADHD-type attention.
              </span>
            </span>
          </label>
        </div>
      </div>
    </section>
  );
}
