// The Serial box's help: every command handleLine() in board.mjs understands (main.cpp's protocol), and
// completion while typing from the art that is loaded (its moods after s, its acts after e). Keep COMMANDS in step
// with handleLine().

import { EVENT } from './board.mjs';

export const COMMANDS = [
  { key: 's', syntax: 's <mood>', args: 'moods', what: 'Goes to a mood through the transitions drawn for it, and stays in it.', example: 's working' },
  { key: 's', syntax: 's demo', what: 'Plays every mood and every act in turn (s cycle is the same).', example: 's demo' },
  { key: 'e', syntax: 'e <act>', args: 'acts', what: 'Plays an act once, then its mood again. With e tap or e fidget the board chooses one, as it does on its own.', example: 'e tap' },
  { key: 'o', syntax: 'o <working> <waiting> <unseen>', hint: true, what: 'The corner marks: sessions working, sessions waiting on you, something finished you have not seen.', example: 'o 1 2 0' },
  { key: 'c', syntax: 'c <RRGGBB>', hint: true, what: 'Fades its body colour to this one in about a second.', example: 'c 3D8BFF' },
  { key: 'h', syntax: 'h <seconds>', hint: true, what: "The bridge's heartbeat: the time of day in seconds since midnight. Its night is from 00:00 to 08:00.", example: 'h 43200' },
  { key: 'X', syntax: 'X', what: 'As if the glass were tapped.', example: 'X' },
  { key: 'T', syntax: 'T <g>', hint: true, what: 'The tap threshold in g, from 0.05 to 4 (0.35 at boot).', example: 'T 0.5' },
  { key: 'i', syntax: 'i', what: 'The motion sensor: its peak jolt in the last 4 s, the taps, the threshold.', example: 'i' },
  { key: '?', syntax: '?', what: "The board's state: mode, target, what is playing, fps, frames.", example: '?' },
  { key: 'W', syntax: 'W', what: 'Its Wi-Fi. The emulator has none, so wifi=off.', example: 'W' },
  { key: 'w', syntax: 'w <ssid> TAB <password> TAB <token> [TAB <tz>]', hint: true, what: 'Saves Wi-Fi and restarts, over USB only. The emulator has no Wi-Fi and answers an error.', example: null },
];

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// the moods and the acts the board holds now (clips included), each act once, as `e` would find it
export function artNames(board) {
  const A = board && board.A;
  if (!A || !A.ok) return { moods: [], acts: [] };
  const moods = A.moodName.slice(0, A.nMoods), acts = [];
  for (let i = 0; i < A.nSeqs; i++)
    if (A.kind[i] === EVENT && board.eventIndex(A.name[i]) === i)
      acts.push({ name: A.name[i], what: `${A.src[i] ? 'clip, ' : ''}from ${A.moodName[A.from[i]]}, ${(A.len[i] / A.fps).toFixed(1)} s` });
  return { moods, acts };
}

function matches(list, typed) {                  // prefix matches first, then the rest that contain it, each in the art's order
  const t = typed.toLowerCase(), head = [], rest = [];
  for (const o of list) { const k = o.name.indexOf(t); if (k === 0) head.push({ ...o, at: 0 }); else if (k > 0) rest.push({ ...o, at: k }); }
  return head.concat(rest).map(o => ({ ...o, len: t.length }));
}

// what to offer for the text typed so far: { items: [{ label, what, value, more }], hint }
export function suggest(value, board, all = false) {
  if (!value.length) return all ? { items: COMMANDS.map(commandItem) } : { items: [] };
  const key = value[0], rest = value.slice(1);
  if (!rest.length) {
    const items = COMMANDS.filter(c => c.key === key).map(commandItem);
    return { items };
  }
  const arg = rest.replace(/^\s+/, '');
  const { moods, acts } = artNames(board);
  if (key === 's') return { items: matches([...moods.map(m => ({ name: m, what: 'mood' })), { name: 'demo', what: 'every mood and act in turn' }], arg).map(o => argItem('s', o)) };
  if (key === 'e') return { items: matches([{ name: 'tap', what: 'the board chooses a tap act' }, { name: 'fidget', what: 'the board chooses a fidget' }, ...acts], arg).map(o => argItem('e', o)) };
  const c = COMMANDS.find(c => c.key === key && c.hint);
  return { items: [], hint: c ? `${c.syntax}: ${c.what}` : null };
}
function commandItem(c) {
  const takes = c.args || c.hint;
  return { label: esc(c.syntax), what: c.what, value: takes ? c.key + ' ' : c.syntax, more: !!takes };
}
function argItem(key, o) {
  const n = o.name, label = o.len ? `${esc(n.slice(0, o.at))}<mark>${esc(n.slice(o.at, o.at + o.len))}</mark>${esc(n.slice(o.at + o.len))}` : esc(n);
  return { label, what: o.what, value: `${key} ${n}`, more: false };
}

// the box: suggestions under it while typing, keyboard and pointer, closed when not in use
export function attach({ input, list, board, onPick }) {
  let items = [], active = -1, open = false;
  const render = (got) => {
    items = got.items;
    active = -1;
    list.innerHTML = items.map((it, i) => `<li role="option" id="sg-${i}" aria-selected="false" data-i="${i}"><span>${it.label}</span><span class="what">${esc(it.what)}</span></li>`).join('')
      + (got.hint ? `<li class="hint" aria-disabled="true">${esc(got.hint)}</li>` : '');
    show(items.length > 0 || !!got.hint);
  };
  const show = (on) => {
    open = on;
    list.hidden = !on;
    input.setAttribute('aria-expanded', String(on));
    if (!on) input.removeAttribute('aria-activedescendant');
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', 'sg-' + i); list.children[i].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const refresh = (all = false) => render(suggest(input.value, board(), all));
  const take = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = it.value;
    input.setSelectionRange(it.value.length, it.value.length);
    if (it.more) refresh(); else show(false);
    if (onPick) onPick(it);
  };
  input.addEventListener('input', () => { if (input.value.length) refresh(); else show(false); });
  input.addEventListener('keydown', e => {
    if (!open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); refresh(true); if (items.length) highlight(0); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      highlight(active < 0 ? (step > 0 ? 0 : items.length - 1) : (active + step + items.length) % items.length);
    } else if (e.key === 'Tab' && !e.shiftKey && items.length) {
      e.preventDefault();
      take(active >= 0 ? active : 0);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      take(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      show(false);
    }
  });
  input.addEventListener('blur', () => show(false));
  list.addEventListener('mousedown', e => e.preventDefault());     // the box keeps its focus (and the list stays open)
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) take(+li.dataset.i); });
  list.addEventListener('pointermove', e => { const li = e.target.closest('li[data-i]'); if (li && +li.dataset.i !== active) highlight(+li.dataset.i); });
  return { close: () => show(false), get open() { return open; } };
}

// the whole list, with an example of each that goes into the box
export function renderHelp(ul, onExample) {
  ul.innerHTML = COMMANDS.map(c => `<li><code>${esc(c.syntax)}</code>${c.example ? `<button type="button" class="ex" data-ex="${esc(c.example)}" title="Put it in the box">${esc(c.example)}</button>` : '<span class="noex">no example</span>'}<span class="d">${esc(c.what)}</span></li>`).join('');
  ul.addEventListener('click', e => { const b = e.target.closest('button[data-ex]'); if (b) onExample(b.dataset.ex); });
}
