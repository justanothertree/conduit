// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import repl from 'repl';
import fetch from 'node-fetch';
import cors from 'cors';

// JSONBin credentials live in the environment, never in the repo: the
// old hardcoded values are already in the public git history
// (revoking them is Josh's call — this only stops them leaking
// further). Set JSONBIN_KEY + JSONBIN_BIN_ID on the Render service;
// without them, high scores simply don't load/save and the server
// still runs.
const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_KEY;
if (!API_KEY || !BIN_ID) console.warn('⚠️ JSONBIN_KEY/JSONBIN_BIN_ID env vars not set — high scores will not load/save.');
const BASE_URL = BIN_ID ? `https://api.jsonbin.io/v3/b/${BIN_ID}` : null;


// Score maps are null-prototype objects (see toScoreStore): no level
// or player name — "__proto__" included — can ever resolve through
// Object.prototype.
let highScores = Object.create(null);

// Rebuild a score record into null-prototype maps, keeping only
// well-formed entries (string level/player <= 64 chars, finite time).
// Used for the JSONBin payload, so a hostile key in stored data can
// never pollute Object.prototype.
function toScoreStore(record) {
  const store = Object.create(null);
  if (!record || typeof record !== 'object') return store;
  for (const [level, players] of Object.entries(record)) {
    if (typeof level !== 'string' || !level || level.length > 64) continue;
    if (!players || typeof players !== 'object') continue;
    const levelStore = Object.create(null);
    for (const [player, data] of Object.entries(players)) {
      if (typeof player !== 'string' || !player || player.length > 64) continue;
      const t = data && typeof data === 'object' ? Number(data.time) : NaN;
      if (!Number.isFinite(t)) continue;
      levelStore[player] = { time: t };
    }
    store[level] = levelStore;
  }
  return store;
}

// Load scores from JSONBin at startup
async function loadHighScores() {
  // Evan hosts his own instance: with no JSONBin credentials the
  // server still runs, scores just don't persist.
  if (!API_KEY || !BIN_ID) {
    console.log('ℹ️ JSONBin skipped (JSONBIN_KEY/JSONBIN_BIN_ID not set) — high scores will not persist.');
    return;
  }
  try {
    const res = await fetch(BASE_URL, {
      headers: { 'X-Master-Key': API_KEY },
    });
    const json = await res.json();
    highScores = toScoreStore(json.record);
    console.log('✅ High scores loaded from JSONBin');
  } catch (e) {
    console.error('❌ Failed to load high scores:', e);
  }
}

// Save scores to JSONBin
async function saveHighScores() {
  if (!API_KEY || !BIN_ID) return;
  try {
    await fetch(BASE_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': API_KEY,
      },
      body: JSON.stringify(highScores),
    });
    console.log('✅ High scores saved to JSONBin');
  } catch (e) {
    console.error('❌ Failed to save high scores:', e);
  }
}

// App setup
const app = express();
const server = http.createServer(app);

// Render health check (render.yaml healthCheckPath).
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.use(cors({
  origin: ['https://krazay17.github.io', 'https://justanothertree.github.io'],
  methods: ['GET', 'POST'],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: [
      "https://krazay17.github.io",
      "https://justanothertree.github.io",
      "http://localhost:5173",
      "http://10.0.0.194:5173",
    ],
    methods: ["GET", "POST"]
  }
});

const players = {};
// (No file-based score store: the old one assigned the
// loadHighScores() Promise to a filename and passed it to
// fs.existsSync, so the path was dead. JSONBin is the only store.)

// Save on shutdown
process.on('SIGINT', () => {
  saveHighScores();
  process.exit();
});
process.on('exit', () => {
  saveHighScores();
});

function getScores() {
  return Object.entries(highScores).map(([level, players]) => {
    const sorted = Object.entries(players)
      .map(([player, data]) => ({ player, time: data.time }))
      .sort((a, b) => a.time - b.time);

    return { level, scores: sorted };
  });
}

// Item 2/5 — the host for a level is its LONGEST-PRESENT player:
// the earliest server-stamped scene-entry time among players whose
// stored data.scene matches, socket id breaking ties. Every client
// runs the same rule on the same stamps (see NetworkManager
// getHostId), so all elect the same host with no extra coordination.
// A player with no stamp yet sorts newest. Returns null when nobody
// is in that level.
//
// Item 3 — server failover: a stamp host that broadcast enemy state
// and then went silent for HOST_SILENCE_MS is skipped, so the
// next-longest-present player becomes the effective host (the three
// host gates below all read this function). A player with no
// lastStateAt has never broadcast as host, so it is never skipped
// for silence. A skipped host that resumes broadcasting is dropped
// by the gates until the effective host goes quiet or disconnects —
// the client-side yield-back (NetworkManager) covers the handover
// the other way.
const HOST_SILENCE_MS = 3000;
function getLevelHostId(sceneKey) {
  const now = Date.now();
  let host = null;
  let hostEnteredAt = Infinity;
  for (const [id, rec] of Object.entries(players)) {
    if (rec.data?.scene !== sceneKey) continue;
    const enteredAt = Number.isFinite(rec.data?.enteredAt) ? rec.data.enteredAt : Infinity;
    if (Number.isFinite(rec.lastStateAt) && now - rec.lastStateAt > HOST_SILENCE_MS) continue;
    if (enteredAt < hostEnteredAt || (enteredAt === hostEnteredAt && (host === null || id < host))) {
      host = id;
      hostEnteredAt = enteredAt;
    }
  }
  return host;
}

// Item 5 — one socket.io room per level. Level-scoped events
// (enemy state / hits / shots) only reach players in the same level.
const levelRoom = (sceneKey) => `level:${sceneKey}`;

// Item 5 — per-socket rate caps for the Part 2 events. A burst
// budget per 1s window; over the cap the packet is dropped silently
// (never an error, never a disconnect — a laggy host just loses a
// tick). Budgets sit above the honest rates with headroom: the host
// broadcasts ~12/s, hits and shots are discrete per attack.
const RATE_LIMITS = {
  enemyStateRequest: 30,
  enemyHitRequest: 40,
  enemyShotRequest: 30,
};
const RATE_WINDOW_MS = 1000;
function checkRate(socket, event) {
  const now = Date.now();
  socket._rate = socket._rate || {};
  const slot = socket._rate[event];
  if (!slot || now - slot.windowStart >= RATE_WINDOW_MS) {
    socket._rate[event] = { windowStart: now, count: 1 };
    return true;
  }
  slot.count += 1;
  return slot.count <= RATE_LIMITS[event];
}

// Handle socket connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.emit('highScoreUpdate', getScores());

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete players[socket.id];
    socket.broadcast.emit('playerLeft', { id: socket.id });
  });

  socket.on('playerSyncRequest', (payload) => {
    const data = payload?.data;
    // Item 1 — drop the packet unless data is an object with a
    // string scene. A null/missing data used to store
    // `data: undefined`, and the next playerStateRequest /
    // playerName / playerLevel then threw reading `.location` /
    // `.name` / `.power` off undefined and killed the process.
    if (!data || typeof data !== 'object' || typeof data.scene !== 'string') return;
    // Default the location so the handlers below can always write
    // data.location.x/y (a sync without one used to crash them).
    if (!data.location || typeof data.location !== 'object') {
      data.location = { x: 0, y: 0 };
    } else {
      if (!Number.isFinite(data.location.x)) data.location.x = 0;
      if (!Number.isFinite(data.location.y)) data.location.y = 0;
    }
    const prev = players[socket.id];
    const isNew = !prev;
    const newScene = data && typeof data.scene === 'string' ? data.scene : null;
    // Item 2 — scene-entry stamp, server clock. A new stamp only
    // when the scene actually changed (or on first sync); a re-sync
    // in the same scene keeps the old one, so a brief reconnect does
    // not lose host seniority. Item 4 — a multiplayer restart
    // (payload.restart, sent by a dying host) re-stamps too: the
    // restarting player becomes newest, so the OTHER player in the
    // level becomes longest-present and takes over as host with its
    // live enemy state — dead enemies stay dead, living ones keep
    // their HP — instead of the fresh scene resetting the level.
    // A disconnect deletes the record, so
    // a player who leaves and comes back is stamped fresh (newest).
    // The stamp is written INTO the stored data object, so it rides
    // the existing broadcasts (existingPlayers / playerJoined /
    // playerSyncUpdate) with no client change — the server stores
    // data opaquely and re-broadcasts it as-is. Client clocks are
    // never compared: every stamp comes from this one clock, so
    // every client elects the same host.
    const sceneChanged = !prev || prev.data?.scene !== newScene;
    const isRestart = payload.restart === true;
    const sceneEnteredAt = (sceneChanged || isRestart) ? Date.now() : (prev.sceneEnteredAt ?? Date.now());
    // Item 3 — carry lastStateAt across the record rebuild: the
    // sync arrives every ~500ms and would otherwise wipe the stamp
    // the failover check reads, so a silent host would never age
    // out while its ghost sync kept flowing.
    players[socket.id] = { data, lastPing: Date.now(), sceneEnteredAt, lastStateAt: prev?.lastStateAt };
    if (data && typeof data === 'object') data.enteredAt = sceneEnteredAt;

    // Item 5 — one room per level, joined on sync: the room follows
    // the player's current scene, so level-scoped events only reach
    // players in the same level.
    const newRoom = newScene ? levelRoom(newScene) : null;
    if (prev?.room && prev.room !== newRoom) socket.leave(prev.room);
    if (newRoom && prev?.room !== newRoom) socket.join(newRoom);
    players[socket.id].room = newRoom;

    if (isNew) {
      socket.broadcast.emit('playerJoined', { id: socket.id, data });
      const existing = Object.entries(players).map(([id, rec]) => ({ id, ...rec }));
      socket.emit('existingPlayers', existing);
    } else {
      socket.broadcast.emit('playerSyncUpdate', { id: socket.id, data });
    }
    // Item 2 — ack the sender with its own stamp. A client never
    // sees its own data in a broadcast, so without this it could
    // not compare its entry time against the other players'.
    socket.emit('playerSyncAck', { enteredAt: sceneEnteredAt });
  });

  socket.on('pingCheck', () => {
    if (players[socket.id]) {
      players[socket.id].lastPing = Date.now();
    }
  });

  socket.on('playerStateRequest', (state) => {
    if (!state || typeof state !== 'object') return;
    const rec = players[socket.id];
    // Item 1 — the record's data can be missing (a sync with no
    // data is dropped now, but never trust it blindly): without the
    // guard, writing .location.x off undefined killed the process.
    if (rec?.data?.location) {
      rec.data.location.x = state.x;
      rec.data.location.y = state.y;
      socket.broadcast.emit('playerStateUpdate', { id: socket.id, state });
    }
  });

  socket.on('playerName', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { text, color } = payload;
    const rec = players[socket.id];
    if (rec?.data) {
      rec.data.name = { text, color };
      socket.broadcast.emit('playerNamed', { id: socket.id, text, color });
    }
  });

  socket.on('playerLevel', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { money, auraLevel } = payload;
    const rec = players[socket.id];
    if (rec?.data) {
      rec.data.power = { money, auraLevel };
      socket.broadcast.emit('playerLeveled', { id: socket.id, money, auraLevel });
    }
  });

  socket.on('updateHealth', (health, max) => {
    if (players[socket.id]) {
      players[socket.id].health = health;
      socket.broadcast.emit('updateHealthUpdate', { id: socket.id, health, max });
    }
  });

  socket.on('playerchatRequest', (message) => {
    if (players[socket.id]) {
      socket.broadcast.emit('playerchatUpdate', { id: socket.id, message });
    }
  });

  socket.on('shurikanthrow', (shotInfo) => {
    if (players[socket.id]) {
      socket.broadcast.emit('shurikanthrown', { id: socket.id, shotInfo });
    }
  });

  // Part 1 of multiplayer combat sync: generic attack visuals.
  // Client emits attackRequest {kind, ...params}; the server only checks
  // the kind is allowlisted and the payload is an object, then broadcasts
  // attackUpdate {id, kind, ...params}. Deep validation (finite numbers,
  // capped arrays) lives on the receiving client — a malformed packet is
  // dropped there and can never throw or corrupt state. Known fields per
  // kind are picked so arbitrary junk from a client is not forwarded.
  const ATTACK_FIELDS = {
    sword: ['start', 'direction', 'angle', 'wave'],
    whip: ['start', 'direction', 'angle'],
    darkorb: ['start', 'velocity'],
    aurazap: ['target'],
  };

  socket.on('attackRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!payload || typeof payload !== 'object') return;
    // Prototype-free lookup: ATTACK_FIELDS is a plain object, so a
    // kind of "__proto__"/"constructor"/"toString" would resolve to
    // Object.prototype (truthy) and `for...of` over it would throw.
    if (typeof payload.kind !== 'string'
      || !Object.hasOwn(ATTACK_FIELDS, payload.kind)) return;
    const fields = ATTACK_FIELDS[payload.kind];
    const validated = { kind: payload.kind };
    for (const field of fields) {
      if (field in payload) validated[field] = payload[field];
    }
    socket.broadcast.emit('attackUpdate', { id: socket.id, ...validated });
  });

  // Part 2 of multiplayer combat sync: host-authoritative enemies.
  // Same pattern as attackRequest (players[socket.id] guard,
  // XRequest in → XUpdate broadcast out). The server only checks the
  // outer shape and picks known fields — deep validation (finite
  // numbers, capped arrays, allowlisted types, per-hit damage cap)
  // lives on the receiving client, and only the elected host applies
  // hits. A malformed packet is dropped here or there and can never
  // throw or corrupt state.
  //
  // enemyStateRequest { sceneKey, full, enemies: [{ netId, type, x,
  // y, vx, vy, hp, alive }] } — batched host broadcast, ~12Hz,
  // delta-compressed by the host, full snapshot ~1s. Item 5: the
  // sender must be in the level it claims AND be that level's host
  // (longest-present rule, same as the clients elect), the packet is
  // rate-capped, every field is type/range-checked, and the broadcast
  // goes to the level room only — never global, never from a
  // non-host. Deep validation (allowlisted types, capped arrays)
  // still lives on the receiving client.
  const ENEMY_STATE_FIELDS = ['netId', 'type', 'x', 'y', 'vx', 'vy', 'hp', 'alive'];
  socket.on('enemyStateRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!checkRate(socket, 'enemyStateRequest')) return;
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.sceneKey !== 'string' || !payload.sceneKey || payload.sceneKey.length > 64) return;
    if (players[socket.id].data?.scene !== payload.sceneKey) return;
    // Item 3 — stamp the heartbeat on any well-formed state packet
    // from a player in this level, BEFORE the host check: a resumed
    // host re-registers as alive by sending, so it can retake
    // authority instead of staying stale-skipped forever (without
    // this, two hosts that both went quiet could never re-elect —
    // only the 10s inactivity kick would save it). Stamping here
    // cannot elect a non-host: the host check below still requires
    // earliest non-stale, and a spammer that keeps itself fresh is
    // by definition alive and broadcasting — a fine host candidate.
    players[socket.id].lastStateAt = Date.now();
    if (getLevelHostId(payload.sceneKey) !== socket.id) return;
    if (!Array.isArray(payload.enemies) || payload.enemies.length > 48) return;
    const enemies = [];
    for (const entry of payload.enemies) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.netId !== 'string' || !entry.netId || entry.netId.length > 64) continue;
      if (typeof entry.type !== 'string' || !entry.type || entry.type.length > 32) continue;
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)
        || !Number.isFinite(entry.vx) || !Number.isFinite(entry.vy)
        || !Number.isFinite(entry.hp)) continue;
      if (typeof entry.alive !== 'boolean') continue;
      const validated = {};
      for (const field of ENEMY_STATE_FIELDS) {
        if (field in entry) validated[field] = entry[field];
      }
      enemies.push(validated);
    }
    socket.to(levelRoom(payload.sceneKey)).emit('enemyStateUpdate', {
      id: socket.id,
      sceneKey: payload.sceneKey,
      full: payload.full === true,
      enemies,
    });
  });

  // enemyHitRequest { netId, damage, kx, ky, stun } — a non-host
  // routes a weapon hit on a puppet to the host, which applies it.
  // Item 5: rate-capped, field-checked, and routed DIRECTLY to the
  // sender's own level host — never broadcast. A hit from another
  // level, or from the host itself (the host applies its own hits
  // locally), is dropped.
  socket.on('enemyHitRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!checkRate(socket, 'enemyHitRequest')) return;
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.netId !== 'string' || !payload.netId || payload.netId.length > 64) return;
    if (!Number.isFinite(payload.damage) || payload.damage <= 0) return;
    if (!Number.isFinite(payload.kx) || !Number.isFinite(payload.ky)) return;
    if (payload.stun !== undefined && !Number.isFinite(payload.stun)) return;
    const sceneKey = players[socket.id].data?.scene;
    if (typeof sceneKey !== 'string' || !sceneKey) return;
    const hostId = getLevelHostId(sceneKey);
    if (!hostId || hostId === socket.id) return;
    const hostSocket = io.sockets.sockets.get(hostId);
    if (!hostSocket) return;
    hostSocket.emit('enemyHitUpdate', {
      id: socket.id,
      netId: payload.netId,
      damage: payload.damage,
      kx: payload.kx,
      ky: payload.ky,
      stun: payload.stun,
    });
  });

  // enemyShotRequest { kind, start: {x, y}, velocity: {x, y} } — a
  // host emits each enemy projectile so non-hosts spawn the same
  // fireball locally. Only 'fireball' exists today. Item 5: only
  // the sender's level host may emit, the packet is rate-capped and
  // field-checked, the level is stamped by the SERVER from the
  // sender's stored scene (never trusted from the payload — the
  // emit site has no scene field), and the broadcast goes to the
  // level room only. The receiver drops anything whose sceneKey is
  // not its own level or whose sender is not its current host.
  socket.on('enemyShotRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!checkRate(socket, 'enemyShotRequest')) return;
    if (!payload || typeof payload !== 'object') return;
    if (payload.kind !== 'fireball') return;
    const sceneKey = players[socket.id].data?.scene;
    if (typeof sceneKey !== 'string' || !sceneKey) return;
    if (getLevelHostId(sceneKey) !== socket.id) return;
    const s = payload.start, v = payload.velocity;
    if (!s || !v || typeof s !== 'object' || typeof v !== 'object') return;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)
      || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return;
    if (Math.abs(s.x) > 100000 || Math.abs(s.y) > 100000
      || Math.abs(v.x) > 2000 || Math.abs(v.y) > 2000) return;
    socket.to(levelRoom(sceneKey)).emit('enemyShotUpdate', {
      id: socket.id,
      kind: payload.kind,
      sceneKey,
      start: { x: s.x, y: s.y },
      velocity: { x: v.x, y: v.y },
    });
  });

  socket.on('highScoreRequest', async (score) => {
    if (score && typeof score === 'object') {
      const { level, time, player } = score;
      const parsedTime = parseFloat(time);
      // Item 2 — prototype pollution, reproduced: a level of
      // "__proto__" wrote onto Object.prototype, because
      // highScores[level] resolved through the prototype chain.
      // Score maps are null-prototype objects (see toScoreStore)
      // and keys are validated here, so no key can ever resolve
      // through a prototype. A bad level/player/time is dropped.
      if (typeof level === 'string' && level && level.length <= 64
        && typeof player === 'string' && player && player.length <= 64
        && Number.isFinite(parsedTime)) {
        if (!Object.hasOwn(highScores, level)) {
          highScores[level] = Object.create(null);
        }
        const levelScores = highScores[level];
        if (!Object.hasOwn(levelScores, player)) {
          levelScores[player] = { time: parsedTime };
          await saveHighScores(); // Save only if it's a new best
        } else if (parsedTime < levelScores[player].time) {
          console.log(`[highScore] ${player} on ${level}: ${parsedTime}`);
          levelScores[player].time = parsedTime;
          await saveHighScores(); // Save only if it's a new best
        }
        console.log(parsedTime);
      }
    }

    io.emit('highScoreUpdate', getScores());
  });

  socket.on('signal', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { to, data } = payload;
    if (typeof to !== 'string' || !to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('join-voice', () => {
    socket.broadcast.emit('user-joined', socket.id);
    console.log('voice join');
  });

  socket.on('pvpDamageRequest', (data) => {
    if (!data || typeof data !== 'object') return;
    if (players[socket.id]) {
      //socket.broadcast.emit('pvpDamageUpdate', { id: socket.id, data });
      // send damage to id
      const targetSocket = io.sockets.sockets.get(data.id);
      if (targetSocket) {
        targetSocket.emit('pvpDamageUpdate', { id: socket.id, data });
      }
    }
  });

  socket.on('pvpKillRequest', (data) => {
    if (!data || typeof data !== 'object') return;
    if (players[socket.id]) {
      const targetSocket = io.sockets.sockets.get(data.killer);
      if (targetSocket) {
        targetSocket.emit('pvpKillUpdate', data)
      }
    }
  });

  socket.on('spawnCardRequest', (cardData) => {
    if (players[socket.id]) {
      socket.broadcast.emit('spawnCardUpdate', { id: socket.id, cardData });
    }
  });

  socket.on('globalChatMessageRequest', (data) => {
    if (players[socket.id]) {
      socket.broadcast.emit('globalChatMessageUpdate', { id: socket.id, data });
    }
  });

});

// Auto-kick inactive players
setInterval(() => {
  const now = Date.now();
  for (const [id, player] of Object.entries(players)) {
    if (now - (player.lastPing || 0) > 10000) {
      const targetSocket = io.sockets.sockets.get(id);
      if (targetSocket) {
        targetSocket.emit('droppedDueToInactivity');
        targetSocket.disconnect(true);
        delete players[id];
        io.emit('playerLeft', { id });
      }
    }
  }
}, 5000);

// REPL for live commands
const r = repl.start('> ');
r.context.io = io;
r.context.connectedSockets = players;

//force disconnect player by 'id'
r.context.forceDrop = (id) => {
  const sock = io.sockets.sockets.get(id);
  if (sock) {
    sock.emit('droppedDueToInactivity');
    sock.disconnect(true);
  }
};

r.context.disconnectSocket = (id) => {
  const socket = io.sockets.sockets.get(id);
  if (socket) {
    console.log(`Force disconnecting ${id}`);
    socket.disconnect(true);
  } else {
    console.log(`Socket ${id} not found`);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

(async () => {
  await loadHighScores();
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
