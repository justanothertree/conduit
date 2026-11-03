import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";

// FLOWLINE's ranged turret: a stationary emplacement guarding chokepoints.
// Watches for the player, telegraphs with a bright flash, then fires one
// aimed fireball on a timer — the same projectile pattern the boss uses
// (Bullet + 'fireballsheet' + SpawnManager.softBulletGroup, aimed with
// physics.velocityFromAngle). No new weapon systems.
//
// Extends _baseEnemy so die() pays the standard money bounty and the red
// health bar shows. Never moves: the body is gravity-less and immovable.
// Player movement/physics untouched.
export default class Turret extends BaseEnemy {
    constructor(scene, x, y, health = 25) {
        super(scene, x, y, 'turret', health);

        this.name = 'turret';
        this.damage = 3;          // contact damage (base playerCollide)
        this.fireRange = 750;     // px — only shoots when the player is near
        this.fireRate = 2400;     // ms between shots
        this.windUp = 350;        // ms telegraph flash before the shot
        this.nextShot = 0;
        this.windingUp = false;
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Boss does.
    }

    init() {
        // Stationary — no patrol/chase behavior to configure.
    }

    activate(x, y, health = 25) {
        super.activate(x, y, health);
        this.clearTint();
        this.scaleCollision(60, 90); // body exists now (in the physics world)
        this.body.allowGravity = false;
        this.body.immovable = true;
        this.body.moves = false;
        this.setVelocity(0, 0);
        this.nextShot = this.scene.time.now + 1200; // a beat before it starts
        this.windingUp = false;
        return true;
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead || this.stunned) return;
        this.facePlayer();
        if (!this.player || this.windingUp) return;
        const now = this.scene.time.now;
        if (now >= this.nextShot && this.distanceToPlayer() < this.fireRange) {
            // Telegraph: flash bright so the shot is fair to dodge.
            this.windingUp = true;
            this.setTint(0xfff176);
            this.scene.time.delayedCall(this.windUp, () => {
                this.windingUp = false;
                this.clearTint();
                if (this.dead || !this.active) return;
                this.shoot();
                this.nextShot = this.scene.time.now + this.fireRate;
            });
        }
    }

    facePlayer() {
        if (!this.player) return;
        this.flipX = this.player.x < this.x;
    }

    // One aimed fireball at the player — mirrors the boss's fireBullet.
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
            Phaser.Math.RadToDeg(angle), 450, bullet.body.velocity);
        // 4s lifespan (same as the boss's) so shots can't fly forever.
        this.scene.time.delayedCall(4000, () => {
            if (bullet.active) bullet.destroy();
        });
    }
}
