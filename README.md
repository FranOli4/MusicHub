# MusicHub

Endless Christian instrumental worship and classical music for **thinking** and **sleeping**, on Windows laptops and Android (Samsung) phones.

- **Two spaces, Think and Sleep.** Each has its own favourites, added songs, style choices and settings. Think is bright and steady; Sleep is slow, soft and dark-screened, with a sleep timer that fades out.
- **Songs never end.** Each song is composed live from a *recipe* (style, key, chords, form) and a *seed*. The form repeats forever, and every pass varies the density and instrument layers, and every few minutes a new chapter brings fresh motifs (and in Think a related key), so long sessions keep evolving without losing the song's identity.
- **Styles:** worship piano, worship ambient, classical, and slow movements (Romanze / Largo). *Classical* picks a composer for each song: a Bach prelude, a Handel air, a Vivaldi concerto, a Haydn quartet, a Mozart serenade or a Schubert impromptu. Some songs quote public-domain tunes: Amazing Grace, Joyful Joyful (Hymn to Joy), and the opening of *Eine kleine Nachtmusik*.
- **♥ Favourite** what's playing; play a favourite on repeat, or **Play all** to rotate through favourites every N minutes.
- **Add songs** three ways:
  1. **Ask an AI:** copy the built-in prompt into Claude or ChatGPT, then paste the JSON reply back. No API key needed.
  2. **Loop an audio file** (MP3/M4A/OGG/WAV), with a crossfade at the loop point.
  3. **Import** a share code or a `.musichub` file from the other device.
- **Share without accounts:** a favourite becomes a short `MH1:…` code you can send over WhatsApp. Audio songs share as a `.musichub` file.

- **Shaped by research on focus and sleep:** no words, moderate tempos, legato lines, gradual change and even loudness. Think has a *Focus level* (Deep work / Balanced / Routine tasks) and an optional focus pulse. Sleep winds down over its first half hour: slower and softer, with the melody receding and a gentle breathing-pace swell. It starts with a 45-minute timer that fades out smoothly. See [docs/music-and-concentration.md](docs/music-and-concentration.md).
- **Ambience:** rain, river, ocean (Sleep) or soft noise under the music, or on its own. In Settings it can keep playing all night after the sleep timer stops the music.

Everything works offline. Instrument samples are bundled, and favourites live on each device (IndexedDB).

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests (engine, recipes, share codes, library) |
| `npm run build` | Production build into `dist/` |
| `npm run samples` | Re-download the instrument samples into `public/samples` (already committed) |
| `npm run android:sync` | Build and copy into the Android project |
| `npm run android:open` | Open the Android project in Android Studio |

## Publish (one-time setup)

1. Create a GitHub repository (it can be private) and push this folder to its `master` branch.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Every push to `master` then runs two workflows:
   - **Publish web app** deploys to `https://<your-user>.github.io/<repo>/`.
   - **Build Android APK** attaches `MusicHub.apk` to the run (under *Artifacts*).

### Windows 11 laptops

Open the Pages URL in **Microsoft Edge**, then choose **⋯ → Apps → Install MusicHub**. It gets a Start-menu entry, runs in its own window, works offline and updates itself. Media keys and the Windows media flyout control playback.

### Samsung phones

1. **Signing key (once).** This keeps updates installing over the old app, so favourites survive. On your laptop:

   ```bash
   keytool -genkeypair -v -keystore musichub.jks -alias musichub -keyalg RSA -keysize 2048 -validity 10000
   ```

   Choose your own passwords when prompted. Keep `musichub.jks` and the passwords somewhere safe and **never commit them** (`*.jks` is in `.gitignore`). Then add four repository secrets under **Settings → Secrets and variables → Actions**:

   | Secret | Value |
   | --- | --- |
   | `MUSICHUB_KEYSTORE_BASE64` | the keystore, base64-encoded (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("musichub.jks")) \| Set-Clipboard`) |
   | `MUSICHUB_KEYSTORE_PASSWORD` | your keystore password |
   | `MUSICHUB_KEY_ALIAS` | `musichub` |
   | `MUSICHUB_KEY_PASSWORD` | your key password |

   Without these secrets the workflow still builds `MusicHub-debug.apk`. It works, but each build has a different signature, so you'd have to uninstall before updating, which loses favourites.
2. Download the APK artifact from the latest **Build Android APK** run and copy it to the phone (or open the GitHub page on the phone).
3. Open the APK and allow **Install unknown apps** for your browser or file manager when asked.
4. Open MusicHub and allow notifications. The playback notification is what keeps music going with the screen off.
5. **Important on Samsung:** go to **Settings → Apps → MusicHub → Battery** and choose **Unrestricted**. Otherwise One UI may put the app to sleep during the night.

## How songs are made

```
recipe + seed ──► Composer (endless bars, deterministic) ──► style textures ──► Tone.js instruments ──► master ──► <audio>
```

| Path | Role |
| --- | --- |
| `src/engine/rng.ts` | Seeded random numbers. The same seed always gives the same music. |
| `src/engine/theory.ts` | Roman-numeral chords (`I`, `V7`, `IVadd9`, `I/3`, `bVII`…), scales, voice leading |
| `src/engine/melody.ts` | Motif → phrase: statement, sequence/inversion, half and full cadences |
| `src/engine/composer.ts` | Endless form; per-cycle variation (density drift, layering, "breathing" passes) |
| `src/engine/styles/` | Worship and classical styles: progressions, textures, recipe generators |
| `src/engine/themes.ts` | Public-domain melodies that songs can quote |
| `src/engine/voices.ts` | Look-ahead scheduler (30 s ahead when the screen is off), audio-file looper |
| `src/engine/player.ts` | Crossfades, pause/resume, sleep timer, favourites rotation |
| `src/recipes/` | Recipe schema (zod) and the LLM prompt |
| `src/library/` | Dexie storage, favourites, share codes, `.musichub` bundles |
| `src/platform/background.ts` | Media Session controls; Android foreground media service |
| `src/ui/` | React screens |

### Recipe format

This is what the AI produces. The **Add song → Ask an AI** prompt explains it in full.

```json
{
  "version": 1,
  "name": "Be Still My Soul (Reflection)",
  "space": "sleep",
  "style": "worship-ambient",
  "key": "D", "scale": "major", "tempo": 48, "meter": 4,
  "sections": [
    { "name": "A", "progression": ["I", "Vsus4 V", "vi", "IVadd9"] },
    { "name": "B", "progression": ["IV", "I/3", "ii7", "Vsus4"] }
  ],
  "form": "AABA",
  "motif": { "steps": [0, 2, -1, -1], "rhythm": [2, 1, 1, 4] },
  "density": 0.25, "brightness": 0.2, "reverb": 0.8
}
```

## Checking it works overnight

Before relying on it for sleep, run one real test on each phone. Start a Sleep song, set the timer to 90 min, lock the screen and leave it charging. It should play without gaps, the notification's Pause/Next buttons should work, and it should fade out at the end.

## Credits

- Salamander Grand Piano by Alexander Holm (CC-BY 3.0).
- Violin, contrabass and harp samples from Versilian Studios VSCO (public domain / CC0).
- Cello and harmonium samples from Freesound (flcellogrl, donyaquick).
- Samples are collected in [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholas Brosowsky.
- Audio engine: [Tone.js](https://tonejs.github.io/) (MIT).
