// playerNetwork.js — ghost sync / spectate logic extracted from Player.
// Behavior-preserving move (2026-09-27): every `this` was the player.

import GameManager from "../GameManager.js";

// Client-side connect guard (multiplayer is live — leaderboard, voice,
// and ghost/player sync all connect).
// socket.io v4 exposes no public "connecting" flag, so we track a manual
// connect() already in flight ourselves. Per-move callers (walk-state enter,
// syncNetwork) may ask for a connection every frame — this fires connect()
// at most once per disconnect/retry cycle instead.
export function ensureSocketConnected(player) {
    const socket = player.network?.socket;
    if (!socket || socket.connected || player.network._connectRequested) return;
    player.network._connectRequested = true;
    const clearConnectRequested = () => { player.network._connectRequested = false; };
    const manager = socket.io;
    // These three outcomes are mutually exclusive per connection cycle, and
    // socket.io's auto-retry spans multiple cycles — so when one fires, drop
    // the other two. Otherwise each retry adds three fresh `once()` listeners
    // while the losing outcomes from the prior cycle stay registered and
    // pile up (N retries → N stale listeners on the next event).
    const onConnect = () => {
        socket.off('connect_error', onConnectError);
        manager?.off('reconnect_failed', onReconnectFailed);
        clearConnectRequested();
    };
    const onConnectError = () => {
        socket.off('connect', onConnect);
        manager?.off('reconnect_failed', onReconnectFailed);
        clearConnectRequested();
    };
    const onReconnectFailed = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        clearConnectRequested();
    };
    socket.once('connect', onConnect);
    // If the handshake itself fails, 'connect_error' fires — clear the flag
    // so the next caller can retry instead of wedging until page reload.
    // socket.io retries on its own too (reconnectionAttempts: 10 in
    // NetworkManager); connect() is a no-op while the manager is already
    // reconnecting, so this can't stack duplicate attempts.
    socket.once('connect_error', onConnectError);
    // If every auto-retry is exhausted the manager emits 'reconnect_failed'
    // and 'connect' will never fire — without this listener the flag would
    // stay true forever and we'd never retry until page reload.
    manager?.once('reconnect_failed', onReconnectFailed);
    socket.connect();
}

export function playerSyncNetwork(player) {
    if (player.tryingToSync) return;
    player.tryingToSync = true;
    setTimeout(() => player.tryingToSync = false, 500);

    ensureSocketConnected(player);

    // Reliable (NOT volatile): this is the level-change sync, and a
    // dropped one leaves the server — and every other client —
    // believing I am still in the old level, so host election, rooms,
    // and ghost visibility all go stale until the next sync. The
    // 500ms throttle above bounds the outbound buffer to ~1 pending
    // packet while the transport is down, so nothing piles up.
    player.network.socket.emit('playerSyncRequest', {
        data: {
            // Scene key for per-level host election (Part 2): the host is
            // the lowest socket id among players in this scene. Sent on
            // every sync so a level change propagates within ~500ms.
            scene: player.scene.scene.key,
            location: GameManager.location,
            name: GameManager.name,
            power: GameManager.power,
            stats: GameManager.stats
        }
    });
}

export function playerSyncGhost(player, delta, state) {
    if (!player.network?.socket) return;

    player.statSyncTimer = (player.statSyncTimer || 0) + delta;

    if (player.statSyncTimer < 15) return;

    player.statSyncTimer = 0;

    // const state = {
    //     x: player.x,
    //     y: player.y,
    //     f: player.flipX ? 1 : 0,
    //     a: player.anims?.currentAnim?.key || '',
    //     c: player.isCrouch ? 1 : 0,
    //     j: !player.body.blocked.down ? 1 : 0,
    //     s: player.isSliding ? 1 : 0,
    //     h: player.isHealing ? 1 : 0,
    //     t: player.stunned ? 1 : 0,
    //     d: player.isDashing ? 1 : 0,
    // };

    if (!player.hasStateChanged(state, player.lastSentState)) return;

    player.lastSentState = { ...state };

    // Volatile: ghost state is superseded by the next frame, so it must be
    // dropped — not buffered — when the transport can't deliver.
    player.network.socket.volatile.emit('playerStateRequest', state);
}

export function playerSpectatePlayer(player, spectate, index) {
    if (!spectate) {
        player.spectating = false;
        player.scene.cameras.main.startFollow(player, false, .05, .05);
        return;
    }
    if (player.network.otherPlayers) {
        const numberofPlayers = Object.keys(player.network.otherPlayers).length;
        player.spectateIndex = Phaser.Math.Clamp(player.spectateIndex + index, 0, numberofPlayers);
        const otherPlayer = Object.values(player.network.otherPlayers)[player.spectateIndex] || Object.values(player.network.otherPlayers)[0];
        if (otherPlayer) {
            player.scene.cameras.main.startFollow(otherPlayer, false, .1, .1)
            player.spectating = true;
        } else {
            player.spectatePlayer(false);
        }
    }
}
