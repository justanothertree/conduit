import io from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';
import GhostPlayer from './GhostPlayer.js';
import GameManager from './GameManager.js';
import PlayerUI from '../scenes/playerUI.js';
import VoiceChatManager from './VoiceChatManager.js';
import Bullet from './bullet.js';

// Part 2 — host-authoritative enemies. The wire type allowlist: the
// canonical lowercase types SpawnManager registers (netType). Anything
// else in a state packet is dropped, never spawned.
const ENEMY_TYPES = new Set([
  'duck', 'bat', 'sunman', 'turret', 'charger', 'bomber',
  'miniboss', 'boss', 'boss2', 'swarmer', 'spitter',
]);
const ENEMY_BROADCAST_HZ_MS = 83; // ~12Hz host broadcast
const ENEMY_MAX_ENTRIES = 48; // per-tick cap (levels hold 17–24)
const ENEMY_FULL_EVERY_TICKS = 12; // full snapshot ~1s, deltas between
const HOST_SILENCE_MS = 3000; // host failover: no state for this long = gone
// Item 8b — failover hysteresis. A phone host whose tab is briefly
// backgrounded has its timers throttled, so its state packets pause
// for seconds; without a hold the election flips host every time it
// wakes and sleeps again. HOST_HOLD_MS: once a failover has taken
// effect, the new host keeps authority this long even if the stamp
// host resumes sending — 10s covers a brief backgrounding (check a
// notification, switch apps) plus the socket's reconnect time, while
// a host that never comes back is simply never retaken. HOST_RETAKE_MS:
// after the hold, the stamp host must show this much STEADY liveness
// before it can retake — at 12Hz that is ~24 consecutive packets,
// enough to prove the tab's timers are actually running again rather
// than a single burst flushed when a throttled tab wakes.
// HOST_STREAK_GAP_MS: a gap longer than this breaks the returning
// host's liveness streak and restarts it.
const HOST_HOLD_MS = 10000;
const HOST_RETAKE_MS = 2000;
const HOST_STREAK_GAP_MS = 1000;

export default class NetworkManager extends Phaser.Events.EventEmitter {
  static instance;

  constructor(scene) {
    super();
    if (NetworkManager.instance) return NetworkManager.instance;
    NetworkManager.instance = this;

    this.scene = scene;
    this.otherPlayers = {};

    // Part 2 — host enemy broadcast runs on a wall-clock interval,
    // not the scene loop: it must keep ticking at ~12Hz regardless of
    // frame rate, and it reads this.scene dynamically so scene swaps
    // just work. The singleton constructor runs once, so one timer
    // exists for the page. _enemyLastSent is the delta baseline
    // (netId → last sent entry); reset on scene change / host gain.
    this._enemyLastSent = null;
    this._enemyTick = 0;
    this._enemyBroadcastTimer = setInterval(
      () => this.broadcastEnemyState(), ENEMY_BROADCAST_HZ_MS);

    // Item 2 — my own scene-entry stamp, server clock. The server
    // stamps enteredAt when it first sees me in a scene and acks it
    // back (playerSyncAck); until the ack arrives it is undefined and
    // I sort as newest. Reset on every scene change (refreshScene).
    this._sceneEnteredAt = undefined;
    // Item 1 — netIds this client has seen a LIVE host entry for, in
    // this scene. A death whose first contact is the death itself
    // (I joined after the host killed it) is removed quietly, never
    // paid. Cleared on scene change (refreshScene).
    this._netSeenAlive = new Set();
    // Item 8b — failover hysteresis state: _failoverAt is when the
    // effective host last stopped being the stamp host (the hold
    // clock runs from here); _stampHostStreakStart is when the
    // stamp host's current run of steady packets began (yield-back
    // needs HOST_RETAKE_MS of it). Both reset on scene change.
    this._failoverAt = null;
    this._stampHostStreakStart = null;
    // Item 3 — blanket puppet switch is pending until the first real
    // host state packet proves a host is broadcasting. Starts true:
    // a client that loads straight into a shared level puppets on
    // the first packet, never before it.
    this._puppetSwitchPending = true;
    this._puppetFallbackTimer = null;
    // Host death-restart (Part 2): the dead netIds preserved at
    // respawnPlayer() so the fresh scene doesn't reset the shared
    // level for the others, plus the scene key they belong to (a
    // level change clears them — re-entry is a fresh run).
    this._preservedDead = null;
    this._preservedDeadScene = undefined;

    // Host failover watchdog: re-run the election every second so a
    // silent host hands over within ~3s + 1s even when no sync event
    // arrives (recomputeHost no-ops when nothing changed).
    this._hostWatchdogTimer = setInterval(() => this.recomputeHost(), 1000);
    // Item 4 — multiplayer restart handover: set by respawnPlayer()
    // before the scene restart, consumed by the next sync (see
    // flagRestart / consumeRestartFlag). While it is set, this
    // client must NOT broadcast enemy state — its fresh scene is
    // full-HP fiction, and one tick of it would reset the shared
    // level (boss HP included) for everyone before the handover
    // lands. Cleared when the server acks the re-stamped sync.
    this._pendingRestart = false;

    // The server URL is configurable: VITE_SERVER_URL (from
    // .env.production — Evan fills in his own Render URL when he
    // hosts) wins, then localhost dev, then the shared Render box.
    // A URL is not a secret, so .env.production is committed.
    const serverURL = import.meta.env.VITE_SERVER_URL
      || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'wss://webconduit.onrender.com');


    this.socket = io(serverURL, {
      reconnection: true,
      // Infinity: the free Render tier cold-starts in ~1 min, so the
      // client must keep retrying instead of giving up after 10.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    const normalizeId = (id) => String(id).replace(/^['"]+|['"]+$/g, '').trim();

    this.voiceChat = new VoiceChatManager(
      this.socket,
      () => null,
      (id) => this.otherPlayers[normalizeId(id)]
    );

    if (this.voiceChat) {
      setInterval(() => {
        this.voiceChat.updateVolumes();
      }, 200);
    };

    // On connection
    this.socket.on('connect', () => {
      console.log('Connected to server:', this.socket.id);

      this.socket.emit('pingCheck');

      // 'connect' fires on every reconnect, but setInterval is permanent —
      // without clearing the old one, each reconnect would add another
      // 5s ping timer (same replace-not-stack convention as the per-level
      // handler fixes). Keep exactly one ping timer live.
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.socket.emit('pingCheck');
      }, 5000);

      // Initial sync request after gathering local player data
      const data = GameManager.getNetworkData(this.scene.scene.key);

      // Item 4 — a multiplayer restart re-syncs with restart:true
      // (see flagRestart): the server re-stamps enteredAt, so the
      // other player in the level becomes host with live state.
      const syncPayload = { data };
      if (this.consumeRestartFlag()) syncPayload.restart = true;
      this.socket.emit('playerSyncRequest', syncPayload);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('Disconnected from server:', reason);
      // You could show a "Reconnecting..." message here if needed

      // Destroy all ghost players
      for (const id in this.otherPlayers) {
        this.otherPlayers[id].destroy();
        delete this.otherPlayers[id];
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected to server after', attemptNumber, 'tries');

      // Re-send player data to re-register this client
      const data = GameManager.getNetworkData(this.scene.scene.key);
      const location = GameManager.getLastLocation();
      this.socket.emit('playerSyncRequest', { x: location.x, y: location.y, data });
    });


    // Add already-connected players
    this.socket.on('existingPlayers', (players) => {
      console.log('Existing players received:', players);
      players.forEach(({ id, data }) => {
        if (id !== this.socket.id) {
          this.addOtherPlayer(id, data);
        }
      });
      this.recomputeHost();
    });

    // New player joined
    this.socket.on('playerJoined', ({ id, data }) => {
      if (!this.otherPlayers[id] && id !== this.socket.id) {
        this.addOtherPlayer(id, data);
      }
      this.recomputeHost();
    });
    // Player left
    this.socket.on('playerLeft', ({ id }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.destroy();
        delete this.otherPlayers[id];
      }
      this.recomputeHost();
    });

    // Item 2 — the server stamps my scene-entry time (one clock for
    // every client) and acks it back: I never see my own data in a
    // broadcast, so this is how I learn my own stamp for the host
    // election. A changed stamp re-runs the election.
    this.socket.on('playerSyncAck', (ack) => {
      const enteredAt = ack?.enteredAt;
      if (!Number.isFinite(enteredAt)) return;
      // Item 4 — a finite ack after a restart means the server has
      // processed a post-restart sync: the handover has landed (new
      // stamp on the new server) or the old server ignored the flag
      // (then the preserved-dead fallback from the previous batch
      // applies instead). Either way, stop suppressing broadcasts.
      if (this._pendingRestart) this._pendingRestart = false;
      if (this._sceneEnteredAt === enteredAt) return;
      this._sceneEnteredAt = enteredAt;
      this.recomputeHost();
    });

    this.socket.on('droppedDueToInactivity', () => {
      console.warn('You were dropped due to inactivity. Resyncing...');
    });

    // General sync update
    this.socket.on('playerSyncUpdate', ({ id, data }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.syncAll(data);
      }
      // A sync carries the sender's current scene, so a level change
      // re-elects the host for both scenes involved.
      this.recomputeHost();
    });


    // Name update
    this.socket.on('playerNamed', ({ id, text, color }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.updateName(text, color);
      }
    });

    this.socket.on('playerStateUpdate', ({ id, state }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.state = state;
        player.x = state.x;
        player.y = state.y;
        player.setGhostState(state);
      }
    })

    this.socket.on('playerLeveled', ({ id, money, auraLevel }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.updatePower(money, auraLevel);
      }
    });

    this.socket.on('shurikanthrown', ({ id, shotInfo }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.ghostShurikan(shotInfo);
      }
    });

    // Multiplayer attack visuals (Part 1): one generic event, validated
    // before anything touches the scene. A malformed packet is dropped
    // silently (console.warn only) — it must never throw or corrupt
    // state. The server allowlists the kind; this handler validates
    // every number and point as well.
    const isAttackPoint = (p) => p && typeof p === 'object'
      && Number.isFinite(p.x) && Number.isFinite(p.y);
    const malformed = (kind) => console.warn('[attackUpdate] malformed packet, dropped:', kind);

    this.socket.on('attackUpdate', (data) => {
      if (!data || typeof data !== 'object') return;
      const player = this.otherPlayers[data.id];
      if (!player) return;
      switch (data.kind) {
        case 'sword':
          if (!isAttackPoint(data.start) || !isAttackPoint(data.direction)
            || !Number.isFinite(data.angle) || typeof data.wave !== 'boolean') { malformed('sword'); return; }
          player.ghostSword(data);
          break;
        case 'whip':
          if (!isAttackPoint(data.start) || !isAttackPoint(data.direction)
            || !Number.isFinite(data.angle)) { malformed('whip'); return; }
          player.ghostWhip(data);
          break;
        case 'darkorb':
          if (!isAttackPoint(data.start) || !isAttackPoint(data.velocity)) { malformed('darkorb'); return; }
          player.ghostDarkOrb(data);
          break;
        case 'aurazap':
          if (!isAttackPoint(data.target)) { malformed('aurazap'); return; }
          player.ghostAuraZap(data);
          break;
        default:
          console.warn('[attackUpdate] unknown kind, dropped:', data.kind);
      }
    });

    this.socket.on('playerchatUpdate', ({ id, message }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.makeChatBubble(message);
      }
    });

    this.socket.on('updateHealthUpdate', ({ id, health, max }) => {
      const player = this.otherPlayers[id];
      if (player) {
        player.updateHealth(health, max);
        player.health = health;
        player.healthMax = max;
        this.emit('healthChanged');

      }
    });

    this.socket.on('highScoreUpdate', (data) => {
      this.scene.updateScoreBoard(data);
    });

    // Part 2 — host-authoritative enemies. Replaces the old symmetric
    // scaffolding (per-enemy enemyStateRequest from replicateEnemy,
    // unvalidated direct setPosition, enemyDamageUpdate): there is now
    // exactly one enemy-sync path, the host's batched broadcast below.
    this.socket.on('enemyStateUpdate', (data) => {
      this.applyEnemyState(data);
    });

    this.socket.on('enemyHitUpdate', (data) => {
      this.applyEnemyHit(data);
    });

    this.socket.on('enemyShotUpdate', (data) => {
      this.applyEnemyShot(data);
    });

    this.socket.on('pvpDamageUpdate', ({id, data}) => {
        const {x, y, damage, stunDuration} = data;
        this.scene.player.TakeDamage(x, y, damage, stunDuration, id);
    });

    this.socket.on('pvpKillUpdate', (data) => {
      const {killer, money} = data;
      this.scene.player.updateMoney(money);
    })

    this.socket.on('spawnCardUpdate', ({ id, cardData }) => {
      const player = this.otherPlayers[id];
      this.scene.spawnManager.spawnCard(cardData);
    });

  }

  addOtherPlayer(id, data) {
    if (this.otherPlayers[id]) {
      this.otherPlayers[id].destroy();
    }

    const ghost = new GhostPlayer(this.scene, id, data);
    this.otherPlayers[id] = ghost;
  }

  // ---- Host election (Part 2, deterministic, client-side) ----
  // The host for a level is the LONGEST-PRESENT player in it (Item
  // 2): the earliest scene-entry timestamp among the players whose
  // data.scene matches my current scene key, socket id breaking ties.
  // A fresh joiner therefore never steals host and respawns dead
  // enemies/bosses at full HP; a player who leaves the level (or
  // disconnects) and comes back gets a fresh stamp and is newest.
  // enteredAt is stamped by the SERVER (one clock — client clocks
  // disagree, so comparing client Date.now() values could elect two
  // hosts) when it first sees a socket in a scene, carried in the
  // sync data (existingPlayers / playerJoined / playerSyncUpdate)
  // and acked back to the sender as playerSyncAck. A player with no
  // stamp yet — not acked, or an old server — sorts as newest, so
  // the election degrades to the old lowest-socket-id rule until
  // every client has a stamp. Alone in a level (or offline — no
  // socket / not connected) I am the host, so solo play is exactly
  // the old local simulation. GhostPlayer stores the last synced
  // data as myData, which is where the scene field lives.
  getHostId(excludeId = null) {
    const socket = this.socket;
    if (!socket?.id) return null;
    const sceneKey = this.scene?.scene?.key;
    if (!sceneKey) return socket.id;
    let host = socket.id;
    let hostEnteredAt = this._sceneEnteredAt ?? Infinity;
    for (const id in this.otherPlayers) {
      if (id === excludeId) continue;
      const p = this.otherPlayers[id];
      if (p?.myData?.scene !== sceneKey) continue;
      const enteredAt = Number.isFinite(p.myData?.enteredAt)
        ? p.myData.enteredAt : Infinity;
      if (enteredAt < hostEnteredAt
        || (enteredAt === hostEnteredAt && id < host)) {
        host = id;
        hostEnteredAt = enteredAt;
      }
    }
    return host;
  }

  // Host failover: the stamp election above is unchanged — but a
  // stamp-host that has gone silent (no valid enemy-state packet
  // for HOST_SILENCE_MS) is treated as gone, and the
  // next-longest-present player takes over. The handover is local
  // first: the new host wakes its puppets and starts broadcasting;
  // the server still gates on its own stamp election, so those
  // packets only flow once the old host disconnects or is kicked
  // for inactivity — but the level keeps simulating locally either
  // way. Only applies once state has actually been seen from a
  // host: before the first packet (and on the old server, where no
  // packets arrive at all) there is nothing to fail over from, and
  // the local-sim fallback stands.
  //
  // Item 8b — hysteresis, so a phone host backgrounded briefly
  // doesn't flip host back and forth. _hostStateSeenAt measures
  // the STAMP host's liveness only (see applyEnemyState): an
  // accepted packet from the failover host must never refresh it,
  // or the silence clock would reset on the very next packet and
  // the failover would un-do itself. Once a failover has taken
  // effect (_failoverAt, maintained by recomputeHost), the new host
  // holds authority for HOST_HOLD_MS; after that, the stamp host
  // retakes only after HOST_RETAKE_MS of steady packets (a single
  // burst flushed when a throttled tab wakes proves nothing).
  getEffectiveHostId() {
    const stampHost = this.getHostId();
    if (!stampHost || stampHost === this.socket?.id) return stampHost;
    if (!this._hostStateSeenAt) return stampHost;
    const now = Date.now();
    const failover = this.getHostId(stampHost);
    if (failover === stampHost) return stampHost;
    // Not in failover yet: the stamp host stays effective while it
    // has been heard from within HOST_SILENCE_MS.
    if (!this._failoverAt) {
      if (now - this._hostStateSeenAt <= HOST_SILENCE_MS) return stampHost;
      return failover;
    }
    // In failover: hold the new host for HOST_HOLD_MS even if the
    // stamp host resumes sending.
    if (now - this._failoverAt < HOST_HOLD_MS) return failover;
    // After the hold, yield back only on sustained stamp-host
    // liveness — steady packets for HOST_RETAKE_MS with no gap
    // over HOST_STREAK_GAP_MS.
    if (this._stampHostStreakStart
      && now - this._stampHostStreakStart >= HOST_RETAKE_MS
      && now - this._hostStateSeenAt <= HOST_STREAK_GAP_MS) {
      return stampHost;
    }
    return failover;
  }

  isHost() {
    const socket = this.socket;
    if (!socket || !socket.connected || !socket.id) return true;
    return this.getEffectiveHostId() === socket.id;
  }

  // Re-run the election after anything that can change it. On a
  // transition, onHostChanged wakes or sleeps the local enemies (see
  // below). First call just records it — there is no previous host
  // to transition from.
  recomputeHost() {
    // Item 8b — maintain the failover window: when the effective
    // host stops being the stamp host, the failover started (the
    // hold clock runs from here); when it returns to the stamp
    // host, the failover is over.
    const eff = this.getEffectiveHostId();
    const stamp = this.getHostId();
    if (eff && stamp && eff !== stamp) {
      if (!this._failoverAt) this._failoverAt = Date.now();
    } else if (eff === stamp) {
      this._failoverAt = null;
    }
    const nowHost = this.isHost();
    if (this._isHost === undefined) {
      this._isHost = nowHost;
      return;
    }
    if (nowHost === this._isHost) return;
    this._isHost = nowHost;
    console.log('[host] ' + (nowHost ? 'I am now host' : 'I am no longer host')
      + ' for ' + (this.scene?.scene?.key ?? '?'));
    this.onHostChanged?.(nowHost);
  }

  refreshScene(scene) {
    this.scene = scene;

    for (const id in this.otherPlayers) {
      const oldGhost = this.otherPlayers[id];
      const { data } = oldGhost.getSyncData();

      oldGhost.destroy();

      this.otherPlayers[id] = new GhostPlayer(scene, id, data);
    }

    // New scene, new election — and the enemy broadcast state (delta
    // snapshot) belongs to the old scene, so reset it. The per-level
    // enemy registry lives on the scene's SpawnManager, which is
    // already the new one by the time this runs. My entry stamp is
    // unknown until the server acks the level-entry sync (Item 2),
    // and the puppet switch is pending again until a host state
    // packet for this scene proves a host is broadcasting (Item 3).
    this._enemyLastSent = null;
    this._enemyTick = 0;
    this._sceneEnteredAt = undefined;
    this._netSeenAlive.clear();
    this._hostStateSeenAt = undefined;
    this._failoverAt = null;
    this._stampHostStreakStart = null;
    // A level change clears the preserved dead set — re-entry is a
    // fresh run. A same-scene restart (host death) keeps it.
    if (this._preservedDead && this._preservedDeadScene !== scene?.scene?.key) {
      this._preservedDead = null;
      this._preservedDeadScene = undefined;
    }
    this._puppetSwitchPending = true;
    if (this._puppetFallbackTimer) {
      clearTimeout(this._puppetFallbackTimer);
      this._puppetFallbackTimer = null;
    }
    this.recomputeHost();
  }

  // ---- Host-authoritative enemies (Part 2) ----

  // Host broadcast, ~12Hz, volatile. One batched packet per tick:
  // { sceneKey, full, enemies: [{ netId, type, x, y, vx, vy, hp,
  // alive }] }. Delta-compressed against the last sent snapshot —
  // only entries that moved, changed HP, or changed liveness go out
  // — with a full snapshot every ~1s so a client that missed packets
  // re-converges and despawns can be detected. Bosses (and freshly
  // dead enemies, whose death must reach every client exactly once)
  // go first; the tick is capped at 48 entries. Non-hosts never emit.
  // Positions/velocities are rounded ints on the wire; HP rides
  // unrounded (damage is fractional once money scaling applies).
  // No per-tick allocation beyond the entry objects themselves — the
  // registry is iterated in place, two passes, no sort, no spread.
  broadcastEnemyState() {
    if (!this.isHost()) return;
    // Item 4 — a multiplayer restart is mid-handover: my fresh
    // scene is full-HP fiction, and one tick of it would reset the
    // shared level (boss HP included) for everyone before the other
    // player takes over. Suppressed until the re-stamp ack lands
    // (see playerSyncAck).
    if (this._pendingRestart) return;
    const socket = this.socket;
    if (!socket?.connected) return;
    // Host death-restart: re-apply the dead set preserved at
    // respawnPlayer() BEFORE building entries, so the fresh scene
    // doesn't broadcast the shared level back to life for the
    // others. Runs on the first tick where the new registry exists.
    if (this._preservedDead?.size) this._applyPreservedDead();
    const sm = this.scene?.spawnManager;
    if (!sm?.netEnemies?.size) return;
    const sceneKey = this.scene.scene.key;
    this._enemyTick = (this._enemyTick ?? 0) + 1;
    const full = this._enemyTick % ENEMY_FULL_EVERY_TICKS === 1;
    const last = this._enemyLastSent ?? new Map();
    const next = new Map(last);
    const entries = [];
    const isBoss = (e) => e.netType === 'boss' || e.netType === 'boss2'
      || e.netType === 'miniboss';
    // Three passes, in priority order: deaths first (a death must
    // never be dropped by the cap), then bosses (their HP drives
    // phases and the boss bar), then everything else.
    for (let pass = 0; pass < 3 && entries.length < ENEMY_MAX_ENTRIES; pass++) {
      for (const enemy of sm.netEnemies.values()) {
        if (entries.length >= ENEMY_MAX_ENTRIES) break;
        if (!enemy.netId) continue;
        const dead = enemy.dead || !enemy.active;
        if (pass === 0 && !dead) continue;
        if (pass === 1 && (dead || !isBoss(enemy))) continue;
        if (pass === 2 && (dead || isBoss(enemy))) continue;
        const entry = this._enemyEntry(enemy, full);
        if (!entry) continue; // already-reported death, nothing new
        if (!full && !this._enemyChanged(entry, last.get(entry.netId))) continue;
        entries.push(entry);
        next.set(entry.netId, entry);
      }
    }
    if (!entries.length) return;
    this._enemyLastSent = next;
    socket.volatile.emit('enemyStateRequest', { sceneKey, full, enemies: entries });
  }

  // Item 4 — multiplayer restart handover. respawnPlayer() calls
  // flagRestart() before the scene restart; the next sync (the new
  // Player's constructor sync, or a reconnect) then carries
  // restart:true, and the server re-stamps enteredAt — the
  // restarting player becomes newest, so the OTHER player in the
  // level becomes longest-present and takes over as host with its
  // live enemy state. The flag stays set until the ack for that
  // sync lands (see playerSyncAck), and while it is set this
  // client broadcasts no enemy state (see broadcastEnemyState).
  // Solo restarts never set it. On the old server the flag is
  // ignored and the preserved-dead fallback below still applies.
  flagRestart() {
    this._pendingRestart = true;
  }

  consumeRestartFlag() {
    return this._pendingRestart === true;
  }

  // Host death-restart (Part 2): snapshot the shared dead set
  // BEFORE the dying host's scene restart, so the fresh local
  // enemies don't reset the level for the other players in it.
  // Captured from the live registry (dead/inactive entries) plus
  // the last broadcast snapshot (dead entries the registry may
  // have pruned). Applied lazily on the first broadcast tick of
  // the new scene (see _applyPreservedDead). Only called when
  // other players share the level — solo deaths restart the level
  // exactly as before.
  preserveSharedEnemyState() {
    const dead = new Set();
    const sm = this.scene?.spawnManager;
    if (sm?.netEnemies) {
      for (const enemy of sm.netEnemies.values()) {
        if (enemy.netId && (enemy.dead || !enemy.active)) dead.add(enemy.netId);
      }
    }
    if (this._enemyLastSent) {
      for (const entry of this._enemyLastSent.values()) {
        if (entry && entry.netId && entry.alive === false) dead.add(entry.netId);
      }
    }
    this._preservedDead = dead;
    this._preservedDeadScene = this.scene?.scene?.key;
  }

  // Re-apply the preserved dead set to the fresh scene's registry:
  // each still-dead enemy is removed quietly (no payout, no loot,
  // no timers — it is already dead in the shared state), so the
  // next full snapshot re-sends it as dead and the other clients
  // converge instead of watching the level repopulate. Ducks keep
  // their respawn trajectory (the restart destroyed the pending
  // timer, so it is re-armed here); dead bosses get their rematch
  // trigger re-armed. Entries for enemies not spawned yet stay
  // pending for the next tick.
  _applyPreservedDead() {
    const sm = this.scene?.spawnManager;
    if (!sm?.netEnemies) return;
    if (this._preservedDeadScene !== this.scene?.scene?.key) {
      this._preservedDead = null;
      this._preservedDeadScene = undefined;
      return;
    }
    let rearmBosses = false;
    for (const netId of [...this._preservedDead]) {
      const enemy = sm.netEnemies.get(netId);
      if (!enemy) continue;
      this._preservedDead.delete(netId);
      if (enemy.dead || !enemy.active) continue;
      enemy.deactivate();
      if (enemy.netType === 'duck') {
        const m = /^duck:(-?\d+):(-?\d+)$/.exec(netId);
        if (m) {
          // Item 8 — the duck already has a once('die') respawn
          // listener from spawnDuck. Do NOT call sm.respawn() (it
          // would register a second one) and do NOT emit('die')
          // (it fired every listener and armed one distance-check
          // timer per listener). Drop the stale listener — the only
          // 'die' listeners on a duck are respawn ones — and arm
          // the timer directly: exactly one timer, no event, and
          // deactivate() never pays, so no payout can double.
          enemy.off('die');
          sm.armDuckRespawn(enemy, Number(m[1]), Number(m[2]),
            enemy.maxHealth ?? 20, sm.spawnDuck.bind(sm));
        }
      } else if (enemy.netType === 'boss' || enemy.netType === 'boss2'
        || enemy.netType === 'miniboss') {
        rearmBosses = true;
      }
    }
    if (rearmBosses) this.rearmBossRematches();
    if (!this._preservedDead.size) {
      this._preservedDead = null;
      this._preservedDeadScene = undefined;
    }
  }

  // One registry enemy → one wire entry, or null when there is
  // nothing new to say (a death already reported). A dead entry is
  // marked sent here, so it is built — and therefore marked — only
  // when it is actually queued for broadcast. Full snapshots
  // re-send deaths even when already reported: a client that joined
  // AFTER the death never saw the delta, and without the re-send
  // its locally-spawned copy of that enemy would stay alive forever
  // as a zombie the host doesn't know about.
  _enemyEntry(enemy, force = false) {
    if (enemy.dead || !enemy.active) {
      if (enemy._netDeathSent && !force) return null;
      enemy._netDeathSent = true;
      return {
        netId: enemy.netId, type: enemy.netType,
        x: Math.round(enemy.x), y: Math.round(enemy.y),
        vx: 0, vy: 0, hp: 0, alive: false,
      };
    }
    const v = enemy.body?.velocity;
    return {
      netId: enemy.netId, type: enemy.netType,
      x: Math.round(enemy.x), y: Math.round(enemy.y),
      vx: Math.round(v?.x ?? 0), vy: Math.round(v?.y ?? 0),
      hp: enemy.health, alive: true,
    };
  }

  // Delta test: 1px of drift and 5px/s of velocity are noise at
  // 12Hz; HP, liveness and type changes always send.
  _enemyChanged(entry, prev) {
    if (!prev) return true;
    return entry.alive !== prev.alive || entry.hp !== prev.hp
      || entry.type !== prev.type
      || Math.abs(entry.x - prev.x) > 1 || Math.abs(entry.y - prev.y) > 1
      || Math.abs(entry.vx - prev.vx) > 5 || Math.abs(entry.vy - prev.vy) > 5;
  }

  // Client apply (Part 2). Everything is validated first — wrong
  // scene, non-object, over-long array, unknown type, or any
  // non-finite / out-of-range number drops that entry (a malformed
  // packet must never throw or corrupt state). For each entry: find
  // the local enemy by netId, or spawn a remote puppet; convert a
  // local enemy to a puppet on first sight; lerp toward the host
  // position; apply host HP; a dead entry for a LIVE local enemy
  // this client has seen alive on the wire runs the LOCAL death path
  // (die() pays the local player and drops local loot — that is how
  // rewards stay per player, each client granting its own from the
  // shared death event; boss rematch re-arm is host-gated inside
  // die(), so a puppet death never re-spawns locally) — but a dead
  // entry with no live local enemy, or for an enemy this client
  // never saw alive (it joined after the kill), is removed quietly
  // instead of revived-and-killed (Item 1). A live entry for a dead
  // local enemy re-activates it as a puppet — that is the
  // host-driven respawn/rematch path. The first valid host packet
  // also runs the pending blanket puppet switch (Item 3); until one
  // arrives, local enemies keep simulating.
  applyEnemyState(data) {
    if (!data || typeof data !== 'object') return;
    if (data.id === this.socket?.id) return;
    if (typeof data.sceneKey !== 'string'
      || data.sceneKey !== this.scene?.scene?.key) return;
    if (!Array.isArray(data.enemies) || data.enemies.length > 64) return;
    // A valid packet from the stamp-elected host proves it is alive
    // — record it even if I took over by failover, so the election
    // yields back to it (recomputeHost flips me to non-host and the
    // packet is then applied below instead of dropped).
    if (data.id === this.getHostId()) {
      // Item 8b — liveness streak for yield-back: a gap over
      // HOST_STREAK_GAP_MS restarts the streak, so a single burst
      // flushed when a throttled tab wakes can never count as
      // sustained liveness.
      const nowMs = Date.now();
      if (!this._stampHostStreakStart
        || nowMs - (this._hostStateSeenAt ?? 0) > HOST_STREAK_GAP_MS) {
        this._stampHostStreakStart = nowMs;
      }
      this._hostStateSeenAt = nowMs;
      this.recomputeHost();
    }
    if (this.isHost()) return; // the host never applies — it IS the authority
    // Item 3 — only the EFFECTIVE host's state applies: a packet
    // from anyone else (a stale stamp host that has not resumed, a
    // third player, a spoofed sender) is dropped. _hostStateSeenAt
    // is refreshed ONLY from stamp-host packets (above) — never
    // from an accepted effective-host packet, or the stamp host's
    // silence clock would reset on the failover host's own packets
    // and the failover would un-do itself on the next tick.
    if (data.id !== this.getEffectiveHostId()) return;
    const sm = this.scene?.spawnManager;
    if (!sm) return;
    // Item 3 — this is a real host state packet, so puppet mode is
    // proven live: run the pending blanket switch (live local
    // enemies become puppets) exactly once. Until this point the
    // enemies stayed on the local simulation — on the current server
    // no host packets arrive at all, so without this gate they would
    // freeze into unkillable puppets.
    if (this._puppetSwitchPending) {
      this._puppetSwitchPending = false;
      if (this._puppetFallbackTimer) {
        clearTimeout(this._puppetFallbackTimer);
        this._puppetFallbackTimer = null;
      }
      this._puppetizeEnemies();
    }
    // Item 8b — _hostStateSeenAt is deliberately NOT refreshed
    // here: it measures the STAMP host's liveness, and refreshing
    // it from the failover host's own packets reset the silence
    // clock and un-did the failover on the next packet.
    const now = this.scene.time.now;
    const seen = new Set();
    for (const e of data.enemies) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.netId !== 'string' || e.netId.length > 64) continue;
      if (!ENEMY_TYPES.has(e.type)) continue;
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)
        || !Number.isFinite(e.vx) || !Number.isFinite(e.vy)
        || !Number.isFinite(e.hp)) continue;
      if (Math.abs(e.x) > 100000 || Math.abs(e.y) > 100000
        || Math.abs(e.vx) > 5000 || Math.abs(e.vy) > 5000) continue;
      if (typeof e.alive !== 'boolean') continue;
      // A live entry marks this enemy as seen alive on the wire
      // (Item 1) — a death that arrives for it later is a shared
      // kill this client was present for, and pays.
      if (e.alive && e.hp > 0) this._netSeenAlive.add(e.netId);
      // Item 1 — a death this client never saw live is removed
      // quietly. The host's ~1s full snapshots re-send every dead
      // enemy, and the old code re-spawned the local copy as a puppet
      // and killed it again — paying out, flashing REMATCH and
      // stacking duck respawn timers once a second, forever. If
      // there is no LIVE local enemy for a dead entry, there is
      // nothing to kill: skip it entirely (no spawn, no die(), no
      // payout, no respawn timer). And if the local enemy IS alive
      // but this client never saw it alive on the wire — first
      // contact with it is its death, i.e. I joined after the host
      // killed it — deactivate it without die(): no payout, no loot,
      // no respawn timer, and no zombie left fighting locally that
      // the host doesn't have. A live local enemy this client HAS
      // seen alive still runs the death path below — that is a
      // shared kill this client was present for, and its own payout
      // is per-player by design.
      if (!e.alive || e.hp <= 0) {
        const local = sm.netEnemies.get(e.netId);
        if (!local || local.dead || !local.active) continue;
        if (!this._netSeenAlive.has(e.netId)) {
          local.deactivate();
          continue;
        }
      }
      seen.add(e.netId);
      let enemy = sm.netEnemies.get(e.netId);
      if (!enemy || enemy.dead || !enemy.active) {
        const spawned = sm.spawnRemote(e.type, e.x, e.y, Math.max(e.hp, 1), e.netId);
        enemy = Array.isArray(spawned) ? sm.netEnemies.get(e.netId) : spawned;
        if (!enemy) continue;
      }
      enemy._netLastSeen = now;
      if (!enemy.isRemote) enemy.setRemote(true);
      enemy.setLerpPosition(e.x, e.y);
      if (!enemy.createdHealthBar) enemy.createHealthBar();
      if (e.hp <= 0 || !e.alive) {
        if (!enemy.dead) {
          enemy.health = 0;
          if (this.scene.player) enemy.die(this.scene.player);
        }
      } else if (e.hp !== enemy.health) {
        enemy.health = e.hp;
      }
    }
    // Full snapshot: a puppet unseen for 2s+ is gone on the host
    // (despawned) — deactivate it. The grace covers spawn timing
    // skew, and the length guard covers a truncated snapshot (a
    // capped full snapshot must never mass-despawn real enemies).
    if (data.full === true && data.enemies.length < ENEMY_MAX_ENTRIES) {
      for (const enemy of sm.netEnemies.values()) {
        if (!enemy.isRemote || !enemy.active || enemy.dead) continue;
        if (seen.has(enemy.netId)) continue;
        if (now - (enemy._netLastSeen ?? 0) < 2000) continue;
        enemy.deactivate();
      }
    }
  }

  // Host applies a routed hit (Part 2). Only the current host for
  // this scene applies it; everyone else (including the hitter's own
  // client, which already flashed) drops it. Validated: netId is a
  // string, damage is a finite number capped at 50 per hit, knockback
  // and stun are finite (stun ≤ 2000ms), and the enemy exists, is
  // live, and is local to the host. The sender must be in my scene
  // if I know them — a hit from another level is stale. The result
  // rides the next state broadcast.
  applyEnemyHit(data) {
    if (!data || typeof data !== 'object') return;
    if (data.id === this.socket?.id) return;
    if (!this.isHost()) return;
    const sender = this.otherPlayers[data.id];
    if (sender && sender.myData?.scene !== this.scene?.scene?.key) return;
    if (typeof data.netId !== 'string') return;
    if (!Number.isFinite(data.damage) || data.damage <= 0 || data.damage > 50) return;
    if (!Number.isFinite(data.kx) || !Number.isFinite(data.ky)) return;
    if (data.stun !== undefined
      && (!Number.isFinite(data.stun) || data.stun < 0 || data.stun > 2000)) return;
    const enemy = this.scene?.spawnManager?.netEnemies.get(data.netId);
    if (!enemy || enemy.dead || !enemy.active || enemy.isRemote) return;
    // allowLifesteal=false: the heal belongs to the hitter only — the
    // non-host heals locally on the routed-hit branch of TakeDamage,
    // so the host must not heal from applying someone else's hit.
    enemy.TakeDamage(data.kx, data.ky, data.damage, data.stun ?? 300, false);
  }

  // Host-fired enemy shot (Part 2). Non-hosts spawn a REAL Bullet in
  // softBulletGroup from the event — local physics, so it can hurt
  // the local player; that is how enemy fire stays dangerous for
  // everyone. The host already has its own local bullet and never
  // applies its own broadcast. Validated like the rest (finite
  // numbers, sane ranges, kind allowlist), and capped at 60 live
  // soft bullets so a lag burst can't pile up shots on a phone.
  // Item 5: the sender must be my level's CURRENT host and the
  // payload must name my level — a shot from anyone else, or from
  // another level, is dropped. The sceneKey is stamped by the
  // server from the sender's stored scene (server.js
  // enemyShotRequest), never trusted from the client, so shots stop
  // arriving until the new server is deployed.
  applyEnemyShot(data) {
    if (!data || typeof data !== 'object') return;
    if (data.id === this.socket?.id) return;
    if (this.isHost()) return;
    // Item 5: the sender must be my level's CURRENT host — the
    // effective host, so shots from a failover host are accepted too.
    if (data.id !== this.getEffectiveHostId()) return;
    if (typeof data.sceneKey !== 'string'
      || data.sceneKey !== this.scene?.scene?.key) return;
    if (data.kind !== 'fireball') return;
    const sm = this.scene?.spawnManager;
    if (!sm?.softBulletGroup) return;
    const s = data.start, v = data.velocity;
    if (!s || !v || typeof s !== 'object' || typeof v !== 'object') return;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)
      || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return;
    if (Math.abs(s.x) > 100000 || Math.abs(s.y) > 100000
      || Math.abs(v.x) > 2000 || Math.abs(v.y) > 2000) return;
    if (sm.softBulletGroup.getChildren().length > 60) return;
    if (!this.scene.anims.get('fireball')) {
      this.scene.anims.create({
        key: 'fireball',
        frames: this.scene.anims.generateFrameNumbers('fireballsheet', { start: 0, end: 2 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    const bullet = new Bullet(this.scene, s.x, s.y, 'fireballsheet');
    sm.softBulletGroup.add(bullet);
    bullet.play('fireball');
    bullet.body.velocity.set(v.x, v.y);
    this.scene.time.delayedCall(4000, () => {
      if (bullet.active) bullet.destroy();
    });
  }

  // Host transition (Part 2 — handoff). Gaining host: puppets wake
  // into AI-driven enemies at their last known position/HP
  // (setRemote(false) resets the attack timers — patrol timers
  // reset is acceptable), the delta baseline is cleared so the
  // first tick sends a full snapshot from the new authority, and
  // dead bosses with their bounty flag set get their rematch
  // trigger re-armed (their die() only armed it while a host).
  // Losing host (Item 3): do NOT puppet immediately. On Josh's
  // current server no host state packets arrive, so an eager switch
  // freezes every enemy into an unkillable puppet. The switch is
  // deferred until the first real host state packet (see
  // applyEnemyState); if none arrives within ~2s, the fallback is
  // simply to stay on the local simulation — enemies stay live and
  // killable, which is strictly better than frozen. A late host
  // packet still triggers the switch then.
  onHostChanged(nowHost) {
    const sm = this.scene?.spawnManager;
    if (!sm?.netEnemies) return;
    if (nowHost) {
      this._enemyLastSent = null;
      this._enemyTick = 0;
      // A pending puppet switch is moot — I am the authority now.
      this._puppetSwitchPending = false;
      if (this._puppetFallbackTimer) {
        clearTimeout(this._puppetFallbackTimer);
        this._puppetFallbackTimer = null;
      }
      for (const enemy of sm.netEnemies.values()) {
        if (enemy.isRemote && enemy.active && !enemy.dead) enemy.setRemote(false);
      }
      this.rearmBossRematches();
    } else {
      this._puppetSwitchPending = true;
      if (this._puppetFallbackTimer) clearTimeout(this._puppetFallbackTimer);
      this._puppetFallbackTimer = setTimeout(() => {
        this._puppetFallbackTimer = null;
        if (this._puppetSwitchPending && !this.isHost()) {
          console.log('[host] no host state in 2s — staying on local simulation');
        }
      }, 2000);
    }
  }

  // Blanket puppet switch (Item 3): the loop the old
  // onHostChanged(false) ran, now gated on proof a host is actually
  // broadcasting. Run once, on the first valid host state packet
  // after losing host (or after loading in as a non-host).
  _puppetizeEnemies() {
    const sm = this.scene?.spawnManager;
    if (!sm?.netEnemies) return;
    for (const enemy of sm.netEnemies.values()) {
      if (!enemy.isRemote && enemy.active && !enemy.dead) enemy.setRemote(true);
    }
  }

  rearmBossRematches() {
    const sm = this.scene?.spawnManager;
    if (!sm) return;
    for (const enemy of sm.netEnemies.values()) {
      if (!enemy.dead || enemy.homeX === undefined) continue;
      let flag = false;
      let spawnFn = null;
      if (enemy.netType === 'boss') {
        flag = !!GameManager.flags.bossRewardPaid;
        spawnFn = () => sm.spawnBoss(enemy.homeX, enemy.homeY);
      } else if (enemy.netType === 'boss2') {
        flag = !!GameManager.flags.boss2RewardPaid;
        spawnFn = () => sm.spawnBoss2(enemy.homeX, enemy.homeY);
      } else if (enemy.netType === 'miniboss') {
        flag = !!GameManager.flags.minibossRewardPaid;
        spawnFn = () => sm.spawnMiniboss(enemy.homeX, enemy.homeY);
      } else {
        continue;
      }
      if (flag) enemy.armRematchTrigger(enemy.homeX, enemy.homeY, spawnFn);
    }
  }

}
