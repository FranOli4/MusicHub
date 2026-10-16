export function About() {
  return (
    <div className="stack about">
      <p>
        Every song is composed live on this device from a recipe and a seed, so it never ends and never repeats exactly. A favourite is a
        few hundred bytes, which is why share codes are so short.
      </p>
      <p>
        The music is shaped by research on focus and sleep: no words, moderate tempos, smooth legato lines, gradual changes, an even
        volume and a soft top end.
      </p>
      <p>
        Sleep leads you down gently over its first half hour: it slows, softens and darkens, the melody recedes so it is less likely to stick
        in your head, and the music swells very slightly about six times a minute, the pace of slow breathing. It starts with a 45-minute timer
        that fades out over up to ten minutes. Rain, river, ocean or noise ambience can play under the music, or on its own all night.
      </p>
      <p>
        Classical songs are new music written in the manner of Bach, Handel, Vivaldi, Haydn, Mozart and Schubert. Some songs quote public-domain melodies: NEW BRITAIN
        (“Amazing Grace”), Beethoven’s HYMN TO JOY (“Joyful, Joyful, We Adore Thee”) and the opening of Mozart’s <i>Eine kleine Nachtmusik</i>.
      </p>
      <p className="muted">
        Instrument samples: Salamander Grand Piano by Alexander Holm (CC-BY 3.0); violin, contrabass and harp from the Versilian Studios
        orchestral samples (VSCO, public domain / CC0); cello and harmonium from Freesound (flcellogrl, donyaquick) via the
        tonejs-instruments collection by Nicholas Brosowsky. Ambience is synthesised on the device. Audio engine: Tone.js (MIT).
      </p>
      <p className="muted">Version {__APP_VERSION__}</p>
    </div>
  );
}
