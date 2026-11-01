import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";

// FLOWLINE's first real boss — a bigger, meaner duck holding the arena at
// the end of Flowline, replacing the old scaled-duck mini-boss.
//
// Boss HP 500 (documented where it's spawned). Phases keyed to HP fraction:
//   Phase 1 (> 66%): patrols the arena, spits one aimed fireball every 2.5s
//   Phase 2 (33–66%): new attack — 3-fireball spread every 2s, moves faster
//   Phase 3 (< 33%): enraged — fastest chase, fireball every 1.2s, leaps at
//     the player
//
// Every attack reuses existing mechanics: contact damage via the base
// playerCollide, fireballs via the same Bullet/'fireballsheet'/softBulletGroup
// pattern as SpawnManager.spawnFireballs (just aimed at the player), and the
// base enemy's setVelocityY jump for the leap. No new weapon systems.
//
// Per-run set piece like the mini-boss was: spawnBoss never re-registers
// for respawn. The big HP bar lives in PlayerUI; the boss shows it on
// activate and hides it on death/deactivate.
export default class Boss extends BaseEnemy {
    static MAX_HEALTH = 500;

    constructor(scene, x, y, health = Boss.MAX_HEALTH) {
        super(scene, x, y, 'duck', health);
        this.name = 'boss';

        this.setScale(.75);
        this.setTint(0xcc55ff); // purple — reads as "boss" next to the old red mini-boss

        this.damage = 8;
        this.speed = 160;
        this.phase = 1;
        this.fireRate = 2500;
        this.nextFireball = 0;
        this.nextLeap = 0;
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like Bat/Duck/Sunman do in init().
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        this.patrol(time);       // inherited ground patrol (uses phase speed)
        this.facePlayer();
        this.tickAttacks(time);
    }

    // Face the player without touching patrol's speed logic.
    facePlayer() {
        if (!this.player) return;
        const dx = this.player.x - this.x;
        if (Math.abs(dx) > 40) this.direction = Math.sign(dx);
        this.flipX = this.direction > 0;
    }

    activate(x, y, health = Boss.MAX_HEALTH) {
        super.activate(x, y, health);
        this.setScale(.75);
        this.setTint(0xcc55ff); // activate() clears tint
        this.scaleCollision(60, 60); // body exists now (in the physics world)
        this.phase = 1;
        this.fireRate = 2500;
        this.speed = 160;
        this.nextFireball = this.scene.time.now + 1500; // a beat before it starts
        this.nextLeap = this.scene.time.now + 4000;
        this.scene.player?.playerUI?.showBossBar(this);
        return true;
    }

    updatePhase() {
        const frac = this.health / this.maxHealth;
        const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
        if (phase === this.phase) return;
        this.phase = phase;
        if (phase === 2) {
            this.fireRate = 2000;
            this.speed = 220;
            this.setTint(0xff8800);
        } else {
            this.fireRate = 1200;
            this.speed = 300;
            this.setTint(0xff2222);
        }
    }

    tickAttacks(time) {
        if (this.dead || this.stunned || !this.player) return;
        this.updatePhase();
        if (time >= this.nextFireball && this.distanceToPlayer() < 900) {
            this.nextFireball = time + this.fireRate;
            this.spitFireballs(this.phase >= 2 ? 3 : 1);
        }
        const onGround = this.body?.blocked.down || this.body?.touching.down;
        if (this.phase === 3 && onGround && time >= this.nextLeap) {
            this.nextLeap = time + 4000;
            const dx = this.player.x - this.x;
            this.setVelocity(Math.sign(dx) * 500, -550);
        }
    }

    // Aimed fireball(s), same projectile pattern as
    // SpawnManager.spawnFireballs (Bullet + 'fireballsheet' + softBulletGroup)
    // but fired toward the player instead of straight left.
    spitFireballs(count = 1) {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup) return;
        if (!this.scene.anims.get('fireball')) {
            this.scene.anims.create({
                key: 'fireball',
                frames: this.scene.anims.generateFrameNumbers('fireballsheet', { start: 0, end: 2 }),
                frameRate: 8,
                repeat: -1,
            });
        }
        const baseAngle = Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y);
        for (let i = 0; i < count; i++) {
            const angle = baseAngle + (i - (count - 1) / 2) * 0.25; // ~14° spread
            const bullet = new Bullet(this.scene, this.x, this.y, 'fireballsheet');
            sm.softBulletGroup.add(bullet);
            bullet.play('fireball');
            this.scene.physics.velocityFromAngle(
                Phaser.Math.RadToDeg(angle), 450, bullet.body.velocity);
        }
    }

    die(player) {
        this.scene.player?.playerUI?.hideBossBar();
        super.die(player);
    }

    deactivate() {
        this.scene?.player?.playerUI?.hideBossBar();
        super.deactivate();
    }
}
