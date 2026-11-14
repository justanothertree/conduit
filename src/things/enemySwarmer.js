import BaseEnemy from "./_baseEnemy.js";

// WORLD 1's swarmer: a small, fast duckling that hunts in packs of three.
// The pack is the point — one swarmer is a 3-HP speed bump, but three of
// them closing from both sides force the player to spend a shurikan
// throw (or a whip swing) instead of kiting one enemy at a time. Packs
// are also what make the shard-shop Pierce and Multishot lines pay off:
// one throw through a pack, or three shurikans at once, clears what
// single-target swings can't.
//
// Reuses existing mechanics only: the same DuckFloaty art as the other
// ducks (lime tint + small scale so it reads as a different, weaker
// animal), the base patrol() for ground movement, and the base die()
// bounty + health bar. No new weapon systems, no movement/physics
// retuning — the 280 patrol speed is this enemy's own AI value, same
// class as the charger's charge speed.
export default class Swarmer extends BaseEnemy {
    constructor(scene, x, y, health = 3) {
        super(scene, x, y, 'duck', health);

        this.name = 'swarmer';
        this.damage = 2;          // contact damage (base playerCollide)
        this.speed = 280;         // px/s — fast ground patrol, the whole threat
        this.setScale(0.22);      // duckling: ~62x79 on screen vs a duck's 85x107
        this.setTint(0x99ff33);   // lime — reads as "small and fast" next to ducks
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Charger does.
    }

    init() {
        // Ground patrol needs no setup beyond the base defaults.
    }

    activate(x, y, health = 3) {
        super.activate(x, y, health);
        this.setScale(0.22);
        this.setTint(0x99ff33); // activate() clears tint
        // Hitbox math: scaleCollision takes SOURCE px and the body displays
        // at source x scale, so (220, 280) -> 48x62 on screen, snug to the
        // visible duckling (a full-frame body would be 62x79 and overlap
        // its pack-mates constantly).
        this.scaleCollision(220, 280);
        this.speed = 280;
        this.direction = Phaser.Math.Between(0, 1) ? 1 : -1;
        return true;
    }

    // After the base hit-flash clears the tint, restore the lime.
    restoreTint() {
        this.setTint(0x99ff33);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead || this.stunned) return;
        // Fast ground patrol (edge-aware, like the charger walk). No chase:
        // the pack's pressure comes from numbers and speed, not homing —
        // three of them patrolling a room at 280px/s already cut off the
        // player's space, and homing would make them un-kitable.
        this.patrol(time);
        this.flipX = this.direction > 0;
    }
}
