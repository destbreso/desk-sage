// The emulator's renderer against the firmware's own vec.h (tools/vec_check.cpp, built with clang++):
// every instruction frame of the test card and its clip, within the bake's tolerance. Skipped without clang++.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, MAX_MEAN, MAX_FAR } from '../checks/vec_fidelity.mjs';

const clang = spawnSync('clang++', ['--version']).status === 0;

for (const name of ['testcard.bin', 'ping.clip']) {
  test(`${name}: drawn as vec.h draws it`, { skip: !clang && 'clang++ is not installed' }, t => {
    const r = compare(fileURLToPath(new URL(`../testcard/${name}`, import.meta.url)));
    t.diagnostic(JSON.stringify(r));
    assert.ok(r.frames > 0);
    assert.deepEqual(r.outside, []);
    assert.equal(r.overflowDisagrees, 0);
    assert.ok(r.worstMean <= MAX_MEAN && r.worstFar <= MAX_FAR);
  });
}
