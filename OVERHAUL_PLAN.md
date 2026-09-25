# Conduit Overhaul Plan

Fork of Josh Massarella's Conduit (https://github.com/krazay17/conduit).
Friend's blessing confirmed 2026-09-25 — working on it was his idea.
License: custom non-commercial. Credit Josh, no commercial use/hosting for profit.

## Codebase snapshot
- ~8,900 lines of JS across 70 files. Phaser 3.90, socket.io, vite.
- Deploys to GitHub Pages via workflow on push to main.
- `Player.js`: 1,515 lines, ~35 methods — the god object. Inline state machine
  (dash/slam/jump/heal/crouch/wallRun/wallSlide/fall/walk/meditate, ~550 lines
  inside setupStates), plus input, health/damage, weapons, networking,
  chat bubbles, money/pickups, animations.
- `states.js` base class exists as a stub — the refactor already wants to happen.
- `healthComponent.js`, `NetworkManager.js` exist — extraction targets ready.
- Dead code: `Level1_old.js` (77 lines, not registered in main.js).
- `GameManager.js`: global mutable singleton (save version 0.118).
- `server/`: 301-line socket.io server + highScores.json.

## Security flag
`src/domStuff/DiscordStuff.js` has a hardcoded Discord webhook URL + token,
public in the repo. Anyone can post to that Discord. Josh should revoke/rotate it.

## Phase 0 — Foundation
- npm install, verify `vite dev` runs, verify `vite build` passes.
- Document run/build/deploy flow.

## Phase 1 — Mobile support (PRIORITY, per Josh 2026-09-25)
Status: in progress.

Done:
- Touch events on on-screen buttons (`touchstart`/`touchend`/`touchcancel`)
  with per-finger tracking → multi-touch works (hold Left + tap Jump).
- `preventDefault` on touchstart suppresses compat mouse events/scroll/zoom.
- `touch-action: none` on buttons, button bar, and game canvas.
- Phone layout (≤760px): compact 6-column thumb grid —
  Left/Right + Jump/Dash on row 1, Crouch/Heal + Interact/Settings on row 2.
  Inventory/Home/Respawn hidden on phone to keep the bar compact.

Known tradeoffs / follow-ups:
- Inventory, Home, Respawn buttons hidden on phone — need a mobile way to
  reach them (or accept Esc-menu-only access).
- Button labels still show key names (A, Space, Shift) — meaningless on phone.
  Could swap to icons/labels on touch devices later.
- Not yet tested on a real phone — needs a device pass (multi-touch feel,
  button sizes, performance on mobile GPU).

## Phase 2 — Quick-win bug fixes (desktop)
- Sort Cards button blocked by invisible overlay (real UI bug).
- Discord widget repeatedly popping open over the game.
- Keyboard focus lost after clicking DOM buttons (keys dead until canvas re-click).
- Delete `Level1_old.js`.
- Flag webhook rotation to Josh.

## Phase 2 — Structural refactor (the "too much to work on" fix)
- Extract Player.js state machine into `playerStuff/states/` modules.
- Move health/damage into `healthComponent.js`.
- Move networking (syncNetwork, syncGhost, spectatePlayer) into `NetworkManager.js`.
- Extract input handling (handleInput, getInput, decideState) into its own module.
- Trim GameManager singleton surface where cheap.
- No behavior changes — pure refactor, game plays identically.

## Phase 3 — Game overhaul (to specify with Yaya)
- Direction TBD: new content, features, rebalance, art, etc.
