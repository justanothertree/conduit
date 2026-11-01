// touchAim.js — tap-to-attack aiming for touch controls.
//
// Desktop aims weapons with the mouse pointer. On touch there is no
// cursor, so the Attack button aims automatically: nearest attackable
// enemy within range, otherwise the player's facing direction.
//
// The fake pointer only needs positionToCamera(), which is all
// _weaponbase.calculateShot() calls on it. It returns world coordinates
// directly (no camera transform needed).

export const TOUCH_AIM_RANGE = 600;
export const TOUCH_AIM_FALLBACK_DIST = 300;

// Pure logic — takes a minimal player-like {x, y, dir, scene} so it can
// be unit-tested without Phaser.
export function computeTouchAim(player, range = TOUCH_AIM_RANGE) {
    const scene = player.scene;
    let best = null;
    let bestD = range;
    const groups = (scene && scene.attackableGroups) || [];
    for (const entry of groups) {
        // Only target actual enemies (zap:true) — not platforms, coins,
        // shards, cards, boosters, portals, or the Home Vault. (The Vault
        // hit would withdraw half the banked Source!)
        if (!entry.zap) continue;
        const group = entry && entry.group;
        if (!group || typeof group.getChildren !== 'function') continue;
        for (const t of group.getChildren()) {
            if (!t || t.active === false || t.dead) continue;
            const dx = t.x - player.x;
            const dy = t.y - player.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
    }
    if (best) return { x: best.x, y: best.y };
    // No enemy in range: aim where the player is facing. flipX tracks
    // facing continuously (playerStates sets it on every move); player.dir
    // is only set during wall-jumps and can be stale, so flipX wins.
    const dir = typeof player.flipX === 'boolean'
        ? (player.flipX ? -1 : 1)
        : (player.dir || 1);
    return { x: player.x + dir * TOUCH_AIM_FALLBACK_DIST, y: player.y - 20 };
}

// Returns a cached fake pointer for the player. positionToCamera()
// recomputes the aim live on every call (weapons call it per frame
// while firing), so a moving target stays targeted while held.
export function getTouchAimPointer(player) {
    if (!player.touchAimPointer) {
        player.touchAimPointer = {
            x: 0,
            y: 0,
            positionToCamera() {
                const aim = computeTouchAim(player);
                this.x = aim.x;
                this.y = aim.y;
                return new Phaser.Math.Vector2(aim.x, aim.y);
            },
        };
    }
    return player.touchAimPointer;
}

// Pure joystick math — also unit-testable. The game's movement reads
// digital left/right/crouch flags, so the floating stick resolves to
// those (a smooth-feeling d-pad, not analog).
export function computeJoystickInput(dx, dy, radius = 60, deadZone = 0.25) {
    const dz = radius * deadZone;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < dz) return { left: false, right: false, crouch: false };
    const nx = dx / radius;
    const ny = dy / radius;
    return {
        left: nx < -deadZone,
        right: nx > deadZone,
        crouch: ny > 0.5,
    };
}
