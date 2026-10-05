// Ladowanie toru w Node (bez Vite)
import fs from 'node:fs';
import path from 'node:path';
import { Track } from '../src/tracks/Track.js';
import { getTrackDef } from '../src/tracks/trackList.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function loadTrack(id) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/tracks/data', `${id}.json`), 'utf8'));
  return new Track(data, getTrackDef(id));
}
