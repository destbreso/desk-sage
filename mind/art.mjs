// What the mind needs of the art: the names of the acts it holds. Read by the emulator's parser (the board's, in
// JavaScript), so a new version of the format is read here as soon as the emulator reads it. Each act's length comes
// with it and only tells the mind how long Sage is busy; an art given by name alone works too.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PARSER = join(dirname(fileURLToPath(import.meta.url)), '..', 'emulator', 'board.mjs');

/** act -> seconds, for every act (event sequence) in the art file. */
export async function readArt(path, parser = PARSER) {
  const { Board, EVENT } = await import(pathToFileURL(parser).href);
  const buf = new Uint8Array(readFileSync(path)), board = new Board({});
  if (!board.parseArt(buf, buf.length, 0)) throw new Error('the emulator\'s parser refused the art');
  const A = board.A, acts = {};
  for (let i = 0; i < A.nSeqs; i++) if (A.kind[i] === EVENT) acts[A.name[i]] = A.len[i] / (A.fps || 24);
  return acts;
}
