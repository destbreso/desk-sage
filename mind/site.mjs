// The website's own code for Sage's face, mood and patience (design/site/sage-site.js, generated from destbreso.com
// by tools/sync-site.sh): a browser bundle that assigns a global, run as it is in a context of its own, never copied.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'site', 'sage-site.js');

export function loadSite(path = SITE) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
  const site = context.SageSite;
  for (const f of ['newPatience', 'stepPatience', 'outOfPatience'])
    if (typeof site?.[f] !== 'function') throw new Error(`${path} has no ${f}`);
  return site;
}
