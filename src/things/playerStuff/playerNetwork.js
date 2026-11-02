// playerNetwork.js — ghost sync / spectate logic extracted from Player.
// Behavior-preserving move (2026-09-27): every `this` was the player.

import GameManager from "../GameManager.js";

// Client-side connect guard (multiplayer is on hold; the server rejects us).
// socket.io v4 exposes no public "connecting" flag, so we track a manual
// connect() already in flight ourselves. Per-move callers (walk-state enter,
// syncNetwork) may ask for a connection every frame — this fires connect()
// at most once per disconnect instead.
export function ensureSocketConnected(player) {
    const socket = player.network?.socket;
    if (!socket || socket.connected || player.network._connectRequested) return;
    player.network._connectRequested = true;
    socket.once('connect', () => { player.network._connectRequested = false; });
    socket.connect();
}

export function playerSyncNetwork(player) {
    if (player.tryingToSync) return;
    player.tryingToSync = true;
    setTimeout(() => player.tryingToSync = false, 500);

    ensureSocketConnected(player);

    // Volatile: a sync request is fire-and-forget state sync. While the
    // server rejects us / the transport is down it is dropped instead of
    // piling up in socket.io's outbound buffer. The 500ms throttle above
    // retries naturally once we're connected again.
    player.network.socket.volatile.emit('playerSyncRequest', {
        data: {
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
