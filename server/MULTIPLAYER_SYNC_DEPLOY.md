# Multiplayer combat sync — deploy notes (Part 1: attack visuals)

For Josh. The client (GitHub Pages site) and the server (`webconduit.onrender.com`)
change together: **the new attack visuals only appear once BOTH are live.**
Old clients keep working — the server ignores events it doesn't know, and new
clients degrade silently if the server hasn't been updated yet (attacks just
don't render on the other client).

## What changed in `server/server.js`

One new handler, inside the `io.on('connection', ...)` block, right after the
existing `shurikanthrow` handler. It follows the exact pattern of the other
handlers (`XRequest` in → `XUpdate` broadcast out, guarded by
`if (players[socket.id])`):

```js
const ATTACK_FIELDS = {
  sword: ['start', 'direction', 'angle', 'wave'],
  whip: ['start', 'direction', 'angle'],
  darkorb: ['start', 'velocity'],
  aurazap: ['target'],
};

socket.on('attackRequest', (payload) => {
  if (!players[socket.id]) return;
  if (!payload || typeof payload !== 'object') return;
  const fields = ATTACK_FIELDS[payload.kind];
  if (!fields) return;
  const validated = { kind: payload.kind };
  for (const field of fields) {
    if (field in payload) validated[field] = payload[field];
  }
  socket.broadcast.emit('attackUpdate', { id: socket.id, ...validated });
});
```

- Client emits `attackRequest` `{ kind, ...params }` (volatile — fire-and-forget,
  dropped rather than buffered when the transport is down).
- Server allowlists `kind` (`sword` / `whip` / `darkorb` / `aurazap`), picks only
  the known fields for that kind, and broadcasts `attackUpdate`
  `{ id: socket.id, kind, ...params }` to everyone else.
- Deep validation (every number finite, every point an `{x, y}` pair, arrays
  length-capped) lives on the receiving client; a malformed packet is dropped
  there and can never throw or corrupt state.
- The existing `shurikanthrow` / `shurikanthrown` pair is unchanged except the
  payload now also carries `chain` (0–5) and `targets` (1–3) so ghost shurikans
  chain the same way. No server change was needed for that — `shotInfo` is
  already passed through untouched.

No new dependencies, no new environment variables, no changes to
`server/package.json`. `node --check server/server.js` passes.

## What changed on the client (for context — no action needed)

- `src/weapons/_weaponbase.js`: new `emitAttack(kind, params)` helper
  (volatile emit, only ever called on a real local fire).
- `WeaponSword`, `WeaponWhip`, `WeaponDarkOrb`, `WeaponAuraZap`: one
  `emitAttack` call each in `fire()` / `zapVisual()`.
- `src/things/NetworkManager.js`: listens for `attackUpdate`, validates the
  packet, dispatches to the ghost.
- `src/things/GhostPlayer.js`: new `ghostSword` / `ghostWhip` /
  `ghostDarkOrb` / `ghostAuraZap` methods — display-only, ~0.5 alpha, never in
  `weaponGroup`, never deals damage, each destroys itself after its duration
  (sword 300ms, whip 250ms, orb 2.5s + fade, zap ~220ms).
- `src/weapons/shurikanProjectile.js`: a visual-only (ghost) shurikan now
  chains against the receiver's own local enemies, display-only. Chain
  targets are NOT sent over the wire: they can't be known at throw time
  (the chain fires when the shurikan hits, async), and the sender's enemy
  positions don't exist on the receiver (no enemy sync in Part 1), so the
  receiver renders hops against what it can actually see.

## How to deploy

1. Get the updated `server/server.js` onto the machine that runs
   `webconduit.onrender.com` and restart/redeploy the service the way you
   normally do (this repo has no `render.yaml`, so the Render service setup
   is yours — however you deployed `server.js` before, do the same again).
   The client side goes live with the normal Pages push of the repo.
2. Confirm the deployed server is actually running this file: after deploy,
   the server log should show no errors on startup, and two clients in the
   same level should see each other's attacks (verification below). If
   attacks don't show, the deployed server is the first thing to check.

## ⚠️ CORS check — please verify, do not assume

`server.js` in this repo lists these Socket.IO CORS origins:

- `https://krazay17.github.io`
- `http://localhost:5173`
- `http://10.0.0.194:5173`

It does **not** list `https://justanothertree.github.io` — yet multiplayer works
from that origin today (ghost movement, leaderboard, voice all connect from
the fork's Pages site). That means either the deployed server differs from
this file, or the origin is allowed some other way. Before / while deploying
this change, please verify the deployed server matches this file, and **add
`https://justanothertree.github.io` to the Socket.IO CORS origins if it is
missing** — otherwise the new `attackRequest` events (and arguably the
existing ones) are one config drift away from breaking on the live site.
The `express` CORS origin (`https://krazay17.github.io`) is a separate setting
for HTTP routes, not the Socket.IO handshake — the Socket.IO list is the one
that matters here.

## How to verify (two clients, same level)

1. Open the site in two browsers/devices (a phone + a desktop is ideal) and
   get both players into the same level.
2. On client A, fire each weapon in turn; on client B confirm you see it:
   - **Sword**: a faint sword swing on the ghost (~300ms); with the wave
     upgrade, a faint wave projectile flying off along the swing.
   - **Whip**: a faint whip flick on the ghost (~250ms).
   - **Dark orb**: a faint orb flying straight from the ghost for ~2.5s,
     then fading (it does not detonate on the receiver — no detonation event
     in Part 1).
   - **Aura zap**: a faint green line from the ghost to the zapped enemy
     (~200ms). Fires automatically on the aura timer, so just stand near an
     enemy and wait.
   - **Shurikan**: the ghost throw plus the Multishot fan (if the sender has
     Multishot) plus chain hops to nearby enemies on the receiver's screen
     (if the sender has the chain upgrade and enemies are near the ghost's
     shurikan when it lands).
3. Confirm the negatives: ghost attacks never damage anything (your health
   doesn't move, enemies don't take damage from a ghost's swing), and a
   malformed client can't break the other side (nothing to test by hand —
   the receiver drops bad packets silently).
4. If an attack doesn't show on the other client: check the server is the
   new deploy (step 2 above), check both clients are on the new Pages build
   (hard refresh), and check the browser console for `[attackUpdate]`
   warnings (a warning means a packet arrived but failed validation).

## What is NOT in this change

- Enemy sync, host election, and enemy AI are untouched — Part 2.
- No movement or physics files were touched.
- No changes to voice, chat, leaderboard, or high scores.

---

# Part 2: host-authoritative enemies

For Josh. Same deploy as Part 1: **the new enemy sync only works once BOTH
the client (Pages push) and the server (this file) are live.** Old clients
keep working — they ignore the new events and run their own local enemies
exactly as before — but two players only share a fight when both are on the
new build. No new dependencies, no new environment variables, no changes to
`server/package.json`. `node --check server/server.js` passes.

## How it works (one paragraph)

Every client still spawns the same enemies from the same tilemap, but only
one of them — the **host**, the lowest socket id among players in that level —
actually runs their AI. The host broadcasts enemy positions + HP ~12 times a
second; everyone else's enemies are puppets that interpolate toward the
host's positions, run no AI, and never take local damage. A weapon hit on a
puppet is routed to the host, which applies it and broadcasts the new HP.
Enemy fireballs are emitted by the host and re-spawned locally on non-hosts,
so they stay dangerous for everyone. When the host leaves or changes level,
the next-lowest player in that level takes over automatically and their
puppets wake up where they are. Rewards stay per player: when the host says
an enemy died, every client runs its own local death path (money, loot).

## What changed in `server/server.js`

Three new handlers, right after the existing `attackRequest` handler, in the
exact same style (`players[socket.id]` guard, `XRequest` in → `XUpdate`
broadcast out, only known fields forwarded). Deep validation lives on the
receiving client; the server checks the outer shape only.

```js
// Batched host broadcast, ~12Hz (delta-compressed by the host, full
// snapshot ~1s). Entries are capped at 48 per packet.
socket.on('enemyStateRequest', (payload) => {
  if (!players[socket.id]) return;
  if (!payload || typeof payload !== 'object') return;
  if (typeof payload.sceneKey !== 'string') return;
  if (!Array.isArray(payload.enemies) || payload.enemies.length > 48) return;
  const enemies = [];
  for (const entry of payload.enemies) {
    if (!entry || typeof entry !== 'object') continue;
    const validated = {};
    for (const field of ['netId', 'type', 'x', 'y', 'vx', 'vy', 'hp', 'alive']) {
      if (field in entry) validated[field] = entry[field];
    }
    enemies.push(validated);
  }
  socket.broadcast.emit('enemyStateUpdate', {
    id: socket.id, sceneKey: payload.sceneKey,
    full: payload.full === true, enemies,
  });
});

// A non-host routes a weapon hit on a puppet to the host.
socket.on('enemyHitRequest', (payload) => {
  if (!players[socket.id]) return;
  if (!payload || typeof payload !== 'object') return;
  if (typeof payload.netId !== 'string') return;
  socket.broadcast.emit('enemyHitUpdate', {
    id: socket.id, netId: payload.netId, damage: payload.damage,
    kx: payload.kx, ky: payload.ky, stun: payload.stun,
  });
});

// A host emits each enemy projectile; non-hosts spawn the same fireball.
socket.on('enemyShotRequest', (payload) => {
  if (!players[socket.id]) return;
  if (!payload || typeof payload !== 'object') return;
  if (payload.kind !== 'fireball') return;
  socket.broadcast.emit('enemyShotUpdate', {
    id: socket.id, kind: payload.kind,
    start: payload.start, velocity: payload.velocity,
  });
});
```

- `enemyStateRequest` → `enemyStateUpdate` `{ id, sceneKey, full, enemies }`.
  The client validates every entry (scene match, allowlisted type, finite
  numbers, capped array) before touching anything.
- `enemyHitRequest` → `enemyHitUpdate` `{ id, netId, damage, kx, ky, stun }`.
  Only the elected host applies the hit, and only for an enemy that exists
  in its own scene (damage capped at 50 per hit client-side too).
- `enemyShotRequest` → `enemyShotUpdate` `{ id, kind, start, velocity }`.
  Kind is allowlisted to `'fireball'` — the only enemy projectile today.
- No server change was needed for host election: the client's sync data now
  carries a `scene` field (the current level key), and the server already
  stores `data` opaquely and re-broadcasts it as-is. The host is the lowest
  socket id among players in the same level, computed on each client.

## What changed on the client (for context — no action needed)

- `GameManager.getNetworkData(sceneKey)` and `playerSyncNetwork` now include
  `scene` (the current level key); level entry re-syncs with the new scene.
- `NetworkManager`: `isHost()` / `recomputeHost()` (re-run on
  `existingPlayers` / `playerJoined` / `playerLeft` / `playerSyncUpdate` /
  scene change); host broadcast tick (~12Hz, delta-compressed, full snapshot
  ~1s, 48 entries/tick, bosses + deaths first); `enemyStateUpdate` /
  `enemyHitUpdate` / `enemyShotUpdate` handlers with full validation;
  `onHostChanged` wakes/sleeps enemies on handoff and re-arms dead bosses'
  rematch triggers when a new host takes over. The old symmetric scaffolding
  (`replicateEnemy`, `enemyDamageUpdate`, direct `setPosition` sync) is
  deleted — this is the only enemy-sync path now.
- `SpawnManager`: every spawned enemy gets a stable `netId`
  (`type:spawnX:spawnY`) and joins a scene-level `netId → enemy` registry;
  `spawnRemote` spawns puppets for host entries; duck respawns are
  host-only.
- `BaseEnemy`: puppets lerp toward host positions (existing lerp path),
  run no AI, route hits to the host with a red flash, and only the host
  emits enemy shots (`emitEnemyShot`). All 11 enemy types gate their
  patrol/chase/attack timers and projectile spawning behind `isRemote`.
- Boss `die()` only arms the rematch trigger on the host; a new host
  re-arms it for dead bosses whose bounty flag is set.
- Solo play is unchanged: alone in a level (or offline) you are the host,
  and the game runs exactly the old local simulation.

## How to deploy

Same as Part 1: get the updated `server/server.js` onto the machine that
runs `webconduit.onrender.com` and restart/redeploy the service the way you
normally do (this repo has no `render.yaml`, so the Render service setup is
yours). The client side goes live with the normal Pages push of the repo.
The CORS note from Part 1 still stands — please verify the deployed server
matches this file, and add `https://justanothertree.github.io` to the
Socket.IO CORS origins if it is missing.

## How to verify (two clients, same level — a phone + a desktop is ideal)

1. Get both players into the same level (Flowline is the quickest: one boss,
   17 enemies; World 1 has 24). Watch both screens for a few seconds:
   enemies should be in the same places on both, moving the same way.
2. On the host (either client — you can't tell which is host from the
   screen, and that's the point), kill a duck. On the other client the same
   duck should fall over at the same spot, and **both** players should get
   the money for it (rewards are per player).
3. On the NON-host client, hit an enemy with a sword/shurikan: you should
   see the red hit flash immediately, and the enemy's health bar should
   drop a beat later when the host's broadcast arrives. The enemy must not
   die from your hits alone if the host hasn't applied them.
4. Stand near a turret (Flowline) or the Flowline boss: fireballs should
   fly on both screens and hurt both players. A boss volley should look
   the same on both — same pattern, same timing.
5. Kill the Flowline boss together: both clients should see the boss bar
   empty, both should get their bounty, and the first-kill loot (2 shards
   + card) should appear on both screens.
6. Handoff: the host leaves the level (Home portal) or closes the tab.
   On the remaining client the fight should keep going — enemies keep
   moving and attacking (they just changed host). No freeze, no duplicated
   enemies, no enemy stuck mid-air.
7. Duck respawn: kill a duck, then walk >1200px away and wait ~5s — it
   should come back on both screens at the same spot.
8. If enemies disagree between screens (one client has an enemy the other
   doesn't, or positions diverge and never re-converge): check the server
   is the new deploy, check both clients are on the new Pages build (hard
   refresh), and check the browser console for `[host]` lines (host
   transitions) and dropped-packet warnings.

## What is NOT in this change

- Attack visuals (Part 1) are untouched.
- No movement or physics files were touched — the host's enemies move
  exactly as before; only who simulates them changed.
- Enemy projectiles from level spawners (the ambient fireball/bullet
  emitters placed in the tilemaps) are still local per client, as before —
  only enemy-fired shots are synced.
- No changes to voice, chat, leaderboard, or high scores.
