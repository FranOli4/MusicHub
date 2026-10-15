// Downloads the instrument samples into public/samples so the app works offline.
// Run once after cloning: `npm run samples`. See src/ui/About.tsx for credits.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const TONEJS_INSTRUMENTS = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

const octaves = (names, from, to) => {
  const out = [];
  for (let o = from; o <= to; o++) for (const n of names) out.push(`${n}${o}`);
  return out;
};

export const SAMPLE_SETS = {
  piano: { base: SALAMANDER, notes: [...octaves(['C', 'Ds', 'Fs', 'A'], 1, 7), 'C8'] },
  violin: { base: `${TONEJS_INSTRUMENTS}violin/`, notes: ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7'] },
  cello: { base: `${TONEJS_INSTRUMENTS}cello/`, notes: ['C2', 'E2', 'G2', 'As2', 'C3', 'E3', 'G3', 'As3', 'C4', 'E4', 'G4', 'C5'] },
  contrabass: { base: `${TONEJS_INSTRUMENTS}contrabass/`, notes: ['G1', 'As1', 'C2', 'D2', 'E2', 'Fs2', 'A2', 'Cs3', 'E3', 'Gs3', 'B3'] },
  harp: { base: `${TONEJS_INSTRUMENTS}harp/`, notes: ['B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6', 'F6', 'A6'] },
  harmonium: { base: `${TONEJS_INSTRUMENTS}harmonium/`, notes: ['C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'G4', 'As4', 'C5'] },
};

const exists = (p) => access(p).then(() => true, () => false);

let fetched = 0;
let skipped = 0;
for (const [name, set] of Object.entries(SAMPLE_SETS)) {
  const dir = join('public', 'samples', name);
  await mkdir(dir, { recursive: true });
  for (const note of set.notes) {
    const file = join(dir, `${note}.mp3`);
    if (await exists(file)) { skipped++; continue; }
    const res = await fetch(`${set.base}${note}.mp3`);
    if (!res.ok) throw new Error(`${name} ${note}: HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('audio') && !type.includes('mpeg') && !type.includes('octet-stream')) {
      throw new Error(`${name} ${note}: unexpected content-type ${type}`);
    }
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    fetched++;
  }
  console.log(`${name}: ${set.notes.length} samples`);
}
const manifest = Object.fromEntries(Object.entries(SAMPLE_SETS).map(([k, v]) => [k, v.notes]));
await writeFile(join('public', 'samples', 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`done: ${fetched} downloaded, ${skipped} already present`);
