// Sage's mind as a process beside the bridge (tools/buddy_bridge.py starts it): the protocol adapter, JSON lines on
// stdin and stdout, one answer a line, in order, with its id. The contract (the first message and its protocol
// version, the signals, the answers) is mind/README.md. It writes nothing else, and logs nothing.

import { createInterface } from 'node:readline';
import { Mind } from './mind.mjs';
import { readArt } from './art.mjs';

const PROTOCOL = 1;
const mind = new Mind();

/** The first message: which protocol the bridge speaks, and the art (a file, or the names of its acts). */
async function art(s) {
  if (s.protocol !== PROTOCOL) return { protocol: PROTOCOL, acts: 0, why: `the bridge speaks protocol ${s.protocol}, this mind ${PROTOCOL}` };
  return { protocol: PROTOCOL, ...mind.know(s.acts || (s.path ? await readArt(s.path) : [])) };
}

async function answer(line) {
  let s;
  try {
    s = JSON.parse(line);
  } catch {
    return { why: 'not a signal: unreadable' };
  }
  if (!s || typeof s !== 'object' || typeof s.signal !== 'string') return { why: 'not a signal' };
  let a;
  try {
    a = s.signal === 'art' ? await art(s) : mind.signal(s);
  } catch (e) {
    a = { why: `could not answer: ${e.message}` };
  }
  return s.id === undefined ? a : { id: s.id, ...a };
}

// (one at a time: reading the art is the one wait)
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  queue = queue.then(() => answer(line)).then((a) => process.stdout.write(JSON.stringify(a) + '\n'));
});
