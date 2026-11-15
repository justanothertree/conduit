// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import repl from 'repl';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import cors from 'cors';

// Support __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN_ID = '685dfd338960c979a5b22637';
const API_KEY = '$2a$10$T5HrVvdoM.0KzR3OnpsdTOGfioI9cIoyAckz3N4XOhTmdRWFNnMn.';
const BASE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;


let highScores = {};
// Load scores from JSONBin at startup
async function loadHighScores() {
  try {
    const res = await fetch(BASE_URL, {
      headers: { 'X-Master-Key': API_KEY },
    });
    const json = await res.json();
    highScores = json.record || {};
    console.log('✅ High scores loaded from JSONBin');
  } catch (e) {
    console.error('❌ Failed to load high scores:', e);
  }
}

// Save scores to JSONBin
async function saveHighScores() {
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

app.use(cors({
  origin: 'https://krazay17.github.io',
  methods: ['GET', 'POST'],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: [
      "https://krazay17.github.io",
      "http://localhost:5173",
      "http://10.0.0.194:5173",
    ],
    methods: ["GET", "POST"]
  }
});

const players = {};
const SCORES_FILE = loadHighScores();
//const SCORES_FILE = path.resolve(__dirname, 'highScores.json');

// Load scores from file
if (fs.existsSync(SCORES_FILE)) {
  try {
    const raw = fs.readFileSync(SCORES_FILE, 'utf-8').trim();
    highScores = raw ? JSON.parse(raw) : {}; // handle empty file
    console.log('Loaded scores:', highScores);
  } catch (e) {
    console.error('Failed to load saved scores:', e);
  }
}

// Save to disk
function saveScores() {
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(highScores, null, 2));
    console.log('Scores saved (sync)');
  } catch (err) {
    console.error('Error saving scores:', err);
  }
}

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

// Handle socket connections
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.emit('highScoreUpdate', getScores());

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete players[socket.id];
    socket.broadcast.emit('playerLeft', { id: socket.id });
  });

  socket.on('playerSyncRequest', ({ data }) => {
    const isNew = !players[socket.id];
    players[socket.id] = { data, lastPing: Date.now() };

    if (isNew) {
      socket.broadcast.emit('playerJoined', { id: socket.id, data });
      const existing = Object.entries(players).map(([id, data]) => ({ id, ...data }));
      socket.emit('existingPlayers', existing);
    } else {
      socket.broadcast.emit('playerSyncUpdate', { id: socket.id, data });
    }
  });

  socket.on('pingCheck', () => {
    if (players[socket.id]) {
      players[socket.id].lastPing = Date.now();
    }
  });

  socket.on('playerStateRequest', (state) => {
    if (players[socket.id]) {
      players[socket.id].data.location.x = state.x;
      players[socket.id].data.location.y = state.y;
      socket.broadcast.emit('playerStateUpdate', { id: socket.id, state });
    }
  });

  socket.on('playerName', ({ text, color }) => {
    if (players[socket.id]) {
      players[socket.id].data.name = { text, color };
      socket.broadcast.emit('playerNamed', { id: socket.id, text, color });
    }
  });

  socket.on('playerLevel', ({ money, auraLevel }) => {
    if (players[socket.id]) {
      players[socket.id].data.power = { money, auraLevel };
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
    const fields = ATTACK_FIELDS[payload.kind];
    if (!fields) return;
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
  // delta-compressed by the host, full snapshot ~1s.
  const ENEMY_STATE_FIELDS = ['netId', 'type', 'x', 'y', 'vx', 'vy', 'hp', 'alive'];
  socket.on('enemyStateRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.sceneKey !== 'string') return;
    if (!Array.isArray(payload.enemies) || payload.enemies.length > 48) return;
    const enemies = [];
    for (const entry of payload.enemies) {
      if (!entry || typeof entry !== 'object') continue;
      const validated = {};
      for (const field of ENEMY_STATE_FIELDS) {
        if (field in entry) validated[field] = entry[field];
      }
      enemies.push(validated);
    }
    socket.broadcast.emit('enemyStateUpdate', {
      id: socket.id,
      sceneKey: payload.sceneKey,
      full: payload.full === true,
      enemies,
    });
  });

  // enemyHitRequest { netId, damage, kx, ky, stun } — a non-host
  // routes a weapon hit on a puppet to the host, which applies it.
  socket.on('enemyHitRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.netId !== 'string') return;
    socket.broadcast.emit('enemyHitUpdate', {
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
  // fireball locally. Only 'fireball' exists today.
  socket.on('enemyShotRequest', (payload) => {
    if (!players[socket.id]) return;
    if (!payload || typeof payload !== 'object') return;
    if (payload.kind !== 'fireball') return;
    socket.broadcast.emit('enemyShotUpdate', {
      id: socket.id,
      kind: payload.kind,
      start: payload.start,
      velocity: payload.velocity,
    });
  });

  socket.on('highScoreRequest', async (score) => {
    if (score) {
      const { level, time, player } = score;
      const parsedTime = parseFloat(time);

      if (!highScores[level]) {
        highScores[level] = {};
      }
      if (!highScores[level][player]) {
        highScores[level][player] = { time: parsedTime };
        await saveHighScores(); // Save only if it's a new best
      } else if (parsedTime < highScores[level][player].time) {
        console.log(`[highScore] ${player} on ${level}: ${parsedTime}`);
        highScores[level][player].time = parsedTime;
        await saveHighScores(); // Save only if it's a new best
      }
      console.log(parsedTime);
    }

    io.emit('highScoreUpdate', getScores());
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('join-voice', () => {
    socket.broadcast.emit('user-joined', socket.id);
    console.log('voice join');
  });

  socket.on('pvpDamageRequest', (data) => {
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
