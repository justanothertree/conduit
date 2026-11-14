import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";

// WORLD 1's spitter: a walking ranged duck that stops at range and spits
// aimed fireballs. The missing half of the ranged/melee mix — turrets
// shoot but never move (so the player picks them off from cover), and
// chargers/swarmers chase but never shoot (so the player kites them).
// The spitter walks INTO the player's space and then shoots from it, so
// the answer is neither cover nor kiting: close the distance while it's
// winding up, or eat a fireball. One shot per volley, long cooldown, so
// it pressures without bullet-helling.
//
// Reuses existing mechanics only: the same DuckFloaty art as the other
// ducks (magenta-pink tint + mid scale so it reads as a caster, not a
// charger), the base patrol() for slow ground movement, and the turret's
// aimed-fireball pattern (Bullet + 'fireballsheet' + softBulletGroup,
// 4s lifespan) with the same yellow telegraph flash. No new weapon
// systems, no movement/physics retuning — the walk speed, range, and
// fire rate are this enemy's own AI values, same class as the turret's.
export default class Spitter extends BaseEnemy {
    constructor(scene, x, y, health = 12) {
        super(scene, x, y, 'duck', health);

        this.name = 'spitter';
        this.damage = 3;          // contact damage (base playerCollide)
        this.walkSpeed = 70;      // px/s — slow patrol, it comes to you
        this.fireRange = 520;     // px — only shoots when the player is near
        this.fireRate = 2600;     // ms between shots
        this.windUp = 400;        // ms telegraph flash before the shot
        this.nextShot = 0;
        this.windingUp = false;
        this.setScale(0.35);      // ~99x125 on screen: between duck and charger
        this.setTint(0xff66aa);   // magenta-pink — reads as "caster"
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Turret does.
    }

    init() {
        // Slow patrol needs no setup beyond the base defaults.
    }

    activate(x, y, health = 12) {
        super.activate(x, y, health);
        this.setScale(0.35);
        this.setTint(0xff66aa); // activate() clears tint
        // Hitbox math: scaleCollision takes SOURCE px and the body displays
        // at source x scale, so (220, 280) -> 77x98 on screen, snug to the
        // visible body (a full-frame body would be 99x125).
        this.scaleCollision(220, 280);
        this.speed = this.walkSpeed;
        this.nextShot = this.scene.time.now + 1500; // a beat before it starts
        this.windingUp = false;
        return true;
    }

    // After the base hit-flash clears the tint, restore the pink.
    restoreTint() {
        this.setTint(0xff66aa);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead || this.stunned) return;
        // Winding up means standing still: the telegraph is only fair if
        // the spitter plants its feet for it (and it gives the player the
        // opening to close in).
        if (this.windingUp) {
            this.setVelocityX(0);
            return;
        }
        this.speed = this.walkSpeed;
        this.patrol(time);
        this.flipX = this.direction > 0;
        if (!this.player) return;
        const now = this.scene.time.now;
        if (now >= this.nextShot && this.distanceToPlayer() < this.fireRange) {
            // Telegraph: flash bright so the shot is fair to dodge —
            // same yellow convention as the turret and the bosses.
            this.windingUp = true;
            this.setTint(0xfff176);
            this.setVelocityX(0);
            this.scene.time.delayedCall(this.windUp, () => {
                this.windingUp = false;
                this.restoreTint();
                if (this.dead || !this.active) return;
                this.shoot();
                this.nextShot = this.scene.time.now + this.fireRate;
            });
        }
    }

    // One aimed fireball at the player — mirrors the turret's shoot().
    shoot() {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup || !this.player) return;
        if (!this.scene.anims.get('fireball')) {
            this.scene.anims.create({
                key: 'fireball',
                frames: this.scene.anims.generateFrameNumbers('fireballsheet', { start: 0, end: 2 }),
                frameRate: 8,
                repeat: -1,
            });
        }
        const angle = Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y);
        const bullet = new Bullet(this.scene, this.x, this.y, 'fireballsheet');
        sm.softBulletGroup.add(bullet);
        bullet.play('fireball');
        this.scene.physics.velocityFromAngle(
            Phaser.Math.RadToDeg(angle), 380, bullet.body.velocity);
        // 4s lifespan (same as the turret's/boss's) so shots can't fly forever.
        this.scene.time.delayedCall(4000, () => {
            if (bullet.active) bullet.destroy();
        });
    }
}
