// The Board's inflate hook under Node (the tests and the checks): zlib's raw inflate, with the window's bytes before
// the frame as its preset dictionary, as tinfl reaches back into them on the board. The page uses prepared() from
// packed.mjs instead, since node:zlib is not there.

import { inflateRawSync } from 'node:zlib';

export function inflate(stream, dictionary, size) {
  try {
    return new Uint8Array(inflateRawSync(stream, { maxOutputLength: size + 1, ...(dictionary.length ? { dictionary } : {}) }));
  } catch { return null; }
}
