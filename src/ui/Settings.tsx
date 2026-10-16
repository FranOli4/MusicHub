import { updateSettings, useSettings } from './controller';

/** One settings page for both spaces. Kept short on purpose; everyday controls live on the Playing screen. */
export function Settings() {
  const think = useSettings('think');
  return (
    <section className="settings-view">
      <h2>Settings</h2>
      <div className="card open">
        <div className="card-body stack">
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
