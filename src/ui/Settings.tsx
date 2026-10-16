import type { Space } from '../recipes/schema';
import { FOCUS_INFO, FocusPicker } from './FocusPicker';
import { updateSettings, useSettings } from './controller';

export function Settings({ space }: { space: Space }) {
  const s = useSettings(space);
  return (
    <section className="settings-view">
      <h2>{space === 'sleep' ? 'Sleep' : 'Think'} settings</h2>
      <div className="card open">
        <div className="card-body stack">
          <label className="field">
            <span>When playing all favourites, change song every</span>
            <select className="input" value={s.minutes} onChange={(e) => updateSettings(space, { minutes: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.shuffle} onChange={(e) => updateSettings(space, { shuffle: e.target.checked })} />
            Shuffle favourites
          </label>
        </div>
      </div>

      <h3 className="section-title">Listening</h3>
      <div className="card open">
        <div className="card-body stack">
          {space === 'think' && (
            <div className="field">
              <span>Focus level</span>
              <FocusPicker />
              <span>{FOCUS_INFO[s.focus].hint}</span>
            </div>
          )}
          {space === 'think' && (
            <label className="check multi">
              <input type="checkbox" checked={s.pulse} onChange={(e) => updateSettings(space, { pulse: e.target.checked })} />
              <span>
                Focus pulse
                <span className="sub">A faint, fast ripple in the volume. One 2024 study found it may help ADHD-type attention.</span>
              </span>
            </label>
          )}
          <label className="check multi">
            <input type="checkbox" checked={s.noise} onChange={(e) => updateSettings(space, { noise: e.target.checked })} />
            <span>
              Soft noise bed
              <span className="sub">
                {space === 'sleep' ? 'Quiet brown noise' : 'Quiet pink noise'} under the music to mask household sounds. Evidence is mixed.
              </span>
            </span>
          </label>
        </div>
      </div>

      <h3 className="section-title">About MusicHub</h3>
      <div className="card open">
        <div className="card-body stack about">
          <p>
            Every song is composed live on this device from a recipe and a seed, so it never ends and never repeats exactly. A favourite is a
            few hundred bytes, which is why share codes are so short.
          </p>
          <p>
            The music is shaped by research on focus and sleep: no words, moderate tempos, smooth legato lines, gradual changes, an even
            volume and a soft top end. Sleep slows, softens and darkens over its first half hour, and the timer fades out over five minutes.
          </p>
          <p>
            Classical styles are new music written in the manner of Mozart and Vivaldi. Some songs quote public-domain melodies: NEW BRITAIN
            (“Amazing Grace”), Beethoven’s HYMN TO JOY (“Joyful, Joyful, We Adore Thee”) and the opening of Mozart’s <i>Eine kleine Nachtmusik</i>.
          </p>
          <p className="muted">
            Instrument samples: Salamander Grand Piano by Alexander Holm (CC-BY 3.0); violin, contrabass and harp from the Versilian Studios
            orchestral samples (VSCO, public domain / CC0); cello and harmonium from Freesound (flcellogrl, donyaquick) via the
            tonejs-instruments collection by Nicholas Brosowsky. Audio engine: Tone.js (MIT).
          </p>
          <p className="muted">Version {__APP_VERSION__}</p>
        </div>
      </div>
    </section>
  );
}
