# desk-sage

Sage, the robot of destbreso.com, as a desk companion on a Waveshare ESP32-S3-LCD-1.3 glass prism display, reacting to what happens on the author's computer. The engine is Joe Bentham's desk-buddy with Chris Simpkins's fork on top (both MIT); Sage is the author's own character.

Read first: `README.md`, then `docs/ROADMAP.md` (only what is left, and the questions that are the author's), `docs/HISTORY.md` (what is done and how it was checked), then `LICENSE-ART.md`.

## This repository names only destbreso.com

It is public, and it names no other project or repository of the author's: only the website. Sage's face, mood and patience come from the website's own code through `tools/sync-site.sh`, which reads the path in `SAGE_SITE` on the author's machine; anything that depends on one of the author's other projects (a mark Sage shows for it, a command it reacts to) lives in the bridge's local config, never in this repository.

## Sage is not open source

- Sage's art (`design/`, every baked frame and clip of it, its voice and sounds, its pictures) is all rights reserved (`LICENSE-ART.md`); the rest is MIT. Keep the MIT notices in `LICENSE` and the credits in the README.
- None of Lump's art comes back: not Joe's drawings, clips, sounds or skill, and not Chris's clips or clip kit (CC BY-NC, and drawn on Lump's model). The `upstream` (joebentham/desk-buddy) and `simpkins` (csimpkins22/desk-buddy) remotes are for code only; a merge from either leaves `design/` and every Lump asset out. An idea taken from their clips is rewritten for Sage, never copied.

## Who Sage is

- Sage's personality is already defined on destbreso.com: alive and never looping (long rests with fidgets, cooldowns, no repeats), likes being looked at, curious at what moves, calm or sleepy when left alone, cross for a while when wronged, its patience spent by bothers and coming back when left alone (dizzy, a glitch or do not disturb when it runs out), drooping below a quarter of its battery, dozing at night. On the desk it is respected and given more depth, never changed into someone else.
- Its face, mood and patience are the website's own code (`design/site/sage-site.js`, generated: never edited by hand). Its body is drawn from the 3D model's own measurements, with one addition the author asked for: the lens on the top edge of its head that its holograms come from.
- Its look: illustrated for everyday (each part lit as a soft cube in flat fills, so the board draws it as instructions), and made of the rain's glyphs for its special moments. No 3D render for now.
- What comes into its world is made for it (its materials, its green, the website's marks, the room's objects), never an emoji or a stock picture. Its worlds are several: the things that come for the author's work (a glitch, the prompt, its modules), the Game of Life on its desk, what it projects as a hologram (as its mind shows on the website), the rain's glyphs. No one theme takes over all the acts.
- Nothing is lost: an act redone keeps the old one beside it as a variant, under a name of its own, unless the author says to drop it. When three acts were redone as Life on the desk, the originals went and the author asked for them back.
- Nothing here says how Sage is found on the website.
- Before a look is baked or changed at scale, show the author a sheet (the reference, now, the proposal) and wait for the yes. Every sheet is kept in `design/sheets/`, numbered after the last, with a line in its README saying what it shows and what was decided: they are the reference for every look after.
- The README's gallery images carry a fingerprint of their content (`?v=` and the first eight characters of the GIF's SHA-1): after drawing the GIFs again, update every fingerprint, or GitHub's image proxy and browsers keep showing the old ones.

## No hardware yet

- Everything is built and checked in the emulator (`emulator/`) against the real bridge. The firmware is compiled but not flashed until the board arrives; a check that needs the board is said to be missing, never assumed.
- Heavy jobs (bakes, renders, compiles in a loop) run under `nice -n 19`.

## The author's machine

- The bridge reads Claude Code's hooks, prompts and commands: it keeps them on the machine, never sends them anywhere, and logs no more than a reaction needs.
- English in code, comments, logs and docs; no em or en dashes; one paragraph per line in markdown.
- The README and every caption in it speak as the author, plainly: first person, short sentences with one idea each, "you" for the reader, contractions welcome. Never chains of clauses, stacked asides or lists after a colon. Text an agent writes for it is read for that before it is merged. Commits carry no AI co-author trailer. Commit locally; push only when the author asks.
