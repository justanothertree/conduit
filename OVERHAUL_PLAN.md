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
- 2026-09-25: build passes (vite build clean). Committed as 35fd6b7 on top of
  upstream. Visual/device verification still pending — no way to screenshot or
  tunnel out of this sandbox, so deployment needs someone with repo access.
- 2026-09-25: real-device report (Yaya's phone) — touch worked for Jump/Dash,
  but Left/Right/Crouch/Heal were off-screen. Root cause: stray buttons at
  grid columns 11 (Hide), 15 (voice), 17 (debug) created implicit grid tracks
  that stretched the 6-column phone bar to ~650px+, pushing the left buttons
  off-screen. Also, inline wide widths (Jump 140px, Dash 100px) overflowed
  their 54px tracks. Fixed by whitelisting only the 8 placed buttons in the
  compact layout, capping widths, and showing action names instead of key
  names on touch. Landscape covered via (pointer: coarse).
- 2026-09-26: bug-fix batch (patch 4, awaiting deploy):
  - Discord widget: `#discord-section` had no left/right anchor, so its
    412x500 transparent box sat over the left of the game canvas intercepting
    clicks in BOTH shown and hidden states. Anchored to right:0; now parks as
    just the 60px toggle tab at the right edge.
  - Sort Cards blocked: hover-scaled first-row cards (z-index 9/10) painted
    over the toolbar buttons. Raised #icon-toolbar to z-index 20.
  - Keyboard dying after clicking cards/buttons: those mousedown handlers
    stopPropagation, so the document-level chat blur never fired and the chat
    input kept keyboard disabled. Now blur chat explicitly on those clicks.
  - Deleted dead src/scenes/Level1_old.js (zero imports).
- 2026-09-27: touch-friendly cards (patch 5c, awaiting deploy):
  - Cards were mouse-only (`mousedown`/`mouseup`/`mouseleave`) — taps did
    nothing on phones. Added touch handlers mirroring mouse: tap = consume,
    800ms hold = lock/unlock, sliding finger off cancels the hold.
  - `preventDefault()` on touchstart suppresses the browser's synthesized
    mouse events, so taps never double-fire. Container-level touch handlers
    keep touches off the game canvas.
  - Small-screen CSS: `touch-action: manipulation` (no tap delay), no
    long-press text selection/callout, smaller cards + tighter grid under
    480px.

## Phase 2 — Quick-win bug fixes (desktop)
- Sort Cards button blocked by invisible overlay (real UI bug).
- Discord widget repeatedly popping open over the game.
- Keyboard focus lost after clicking DOM buttons (keys dead until canvas re-click).
- Delete `Level1_old.js`.
- Flag webhook rotation to Josh.

## Phase 2 — Structural refactor (the "too much to work on" fix)
- [x] 2026-09-27: Player.js decomposed 1515 → ~787 lines (patch 5c, awaiting
  deploy). All 14 state definitions → playerStuff/playerStates.js; health
  (TakeDamage/adjustHealth/updateHealth) → playerStuff/playerHealth.js;
  networking (syncGhost/syncNetwork/spectatePlayer) → playerStuff/playerNetwork.js.
  Pure code motion — Player keeps thin wrappers, external callers untouched.
  Build passes. (Health went to a new module rather than the old
  healthComponent.js stub, which was never wired up.)
- Extract Player.js state machine into `playerStuff/states/` modules.
- Move health/damage into `healthComponent.js`.
- Move networking (syncNetwork, syncGhost, spectatePlayer) into `NetworkManager.js`.
- Extract input handling (handleInput, getInput, decideState) into its own module.
  - [x] Done 2026-09-27 (batch 6): `handleInput`, `decideState`, `getInput`,
    `setState`, `walkLerp` → `playerStuff/playerInput.js`. Player keeps thin
    wrappers; build passes.
- Trim GameManager singleton surface where cheap.
  - [x] Reviewed 2026-09-27: already 126 lines and focused; only cheap trim was
    removing a dead `GameManager.money` write in `reset()` that nothing read.
- No behavior changes — pure refactor, game plays identically.

## Phase 3 — Game overhaul (to specify with Yaya)
- Direction TBD: new content, features, rebalance, art, etc.

## Patches (raw URLs — apply in order on desktop)
- **touch23** — landscape + off-screen controls:
  https://muse.ai/files/1268891369648037/2315834635924218/t14tt8eilbm4bmsimgwxdzjb/conduit-mobile-touch-23.patch
  (re-uploaded 2026-09-28, expires 2026-10-01 01:37 UTC)
- **bugfix4** — Discord overlay, Sort Cards, chat focus, dead code:
  https://muse.ai/files/1268891369648037/1883485996355469/4vvki3a5rc3tsy9iv9r7rc70/conduit-bugfix-4.patch
  (re-uploaded 2026-09-28, expires 2026-10-01 01:37 UTC)
- **refactor5c** — chat width cap + full Player.js decomposition (batches 5–7)
  + touch-friendly cards + GameManager dead-write removal:
  https://muse.ai/files/1268891369648037/1761565955164792/eu4icrn3kxof8i4n0dqvbqsc/conduit-refactor-5c.patch
  (expires 2026-09-29 23:08 UTC; supersedes refactor5b)
