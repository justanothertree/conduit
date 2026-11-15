import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";

// WORLD 1's flying bomber: a bat-variant that hovers above the fight and
// drops explosives straight down. The new combat problem is vertical
// awareness — turrets shoot at you, chargers dash at you, but the bomber
// punishes standing still: its bombs fall where you were, so you have to
// keep moving sideways. It never touches the ground, so melee has to
// reach up (or the shurikan does the work).
//
// Visibility: bombers hover high enough to sit above a phone screen's
// top edge and go unnoticed until a bomb lands. A ground shadow marker
// (dark ellipse with an orange ring) sits on the floor directly below
// each bomber while the player is in its drop range, so the threat
// reads on the ground the player is actually looking at — the bomber
// itself can stay high. The marker is purely visual: it never damages,
// blocks, or changes the drop telegraph.
//
// Reuses existing mechanics only: bat flight (allowGravity false, same
// 'bat' art, orange tint so it reads as "explosive"), the turret's
// fireball pattern (Bullet + 'fireballsheet' + softBulletGroup, aimed
// straight down, 4s lifespan), and the base enemy's die() bounty +
// health bar. No new weapon systems, no movement/physics retuning —
// the hover drift and bob are this enemy's own AI values, same class as
// the turret's fire rate or the charger's charge speed.
export default class Bomber extends BaseEnemy {
    constructor(scene, x, y, health = 15) {
        super(scene, x, y, 'bat', health);

        this.name = 'bomber';
        this.damage = 3;          // contact damage (base playerCollide)
        this.driftSpeed = 60;     // px/s — slow hover toward the player
        this.dropRange = 700;     // px — only bombs when the player is near
        this.dropRate = 2800;     // ms between bomb drops
        this.windUp = 400;        // ms telegraph flash before the drop
        this.nextDrop = 0;
        this.windingUp = false;
        this.baseY = y;           // hover anchor — set properly in activate()
        this.groundTop = null;    // floor below the bomber — scanned in activate()
        this.marker = null;       // ground shadow marker (created in activate)
        this.setTint(0xff8800);   // orange — reads as "explosive" next to bats
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Turret does.
    }

    init() {
        // Hover anchor refreshes on every (re)spawn; the drift/bob math
        // in preUpdate steers around it.
        this.baseY = this.y;
    }

    activate(x, y, health = 15) {
        super.activate(x, y, health);
        this.setTint(0xff8800); // activate() clears tint
        this.scaleCollision(40, 40); // body exists now (in the physics world)
        this.body.allowGravity = false;
        this.setVelocity(0, 0);
        this.baseY = y;
        this.nextDrop = this.scene.time.now + 1500; // a beat before it starts
        this.windingUp = false;
        // Ground shadow: scan the walls layer below the spawn point for
        // the floor (same pattern as the mini-boss's groundTop scan) and
        // put a dark ellipse with an orange ring on it, tracking the
        // bomber's x. No floor within 900px (over a pit) means no marker
        // rather than a marker floating in the void.
        this.groundTop = null;
        const walls = this.scene.walls;
        if (walls) {
            for (let py = y; py < y + 900; py += 8) {
                const tile = walls.getTileAtWorldXY(x, py);
                if (tile && tile.index !== -1) { this.groundTop = tile.pixelY; break; }
            }
        }
        if (!this.marker && this.groundTop !== null) {
            this.marker = this.scene.add.ellipse(x, this.groundTop - 2, 44, 12, 0x000000, 0.35)
                .setStrokeStyle(2, 0xff8800, 0.8)
                .setDepth(1)
                .setVisible(false);
        }
        return true;
    }

    deactivate() {
        // The marker is a plain scene object, not a pooled child — destroy
        // it here so a deactivated bomber leaves no stale shadow behind.
        // activate() recreates it on the next spawn.
        if (this.marker) { this.marker.destroy(); this.marker = null; }
        super.deactivate();
    }

    // After the base hit-flash clears the tint, restore the orange.
    restoreTint() {
        this.setTint(0xff8800);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead || this.stunned) return;
        // Remote puppet: no hover, no marker, no bomb telegraph.
        if (this.isRemote) return;
        this.hover(time);
        // The shadow tracks the bomber's x and only shows while the player
        // is in drop range — the same window the bomber can actually
        // attack in, so the marker appears exactly when it matters and
        // never clutters a room the player is just walking through.
        if (this.marker) {
            const near = this.player && this.distanceToPlayer() < this.dropRange;
            this.marker.setVisible(!!near);
            if (near) this.marker.x = this.x;
        }
        if (!this.player || this.windingUp) return;
        const now = this.scene.time.now;
        if (now >= this.nextDrop && this.distanceToPlayer() < this.dropRange) {
            // Telegraph: flash bright so the drop is fair to dodge —
            // the bomb falls where the player WAS, so moving sideways
            // during the flash is the whole counterplay.
            this.windingUp = true;
            this.setTint(0xfff176);
            this.scene.time.delayedCall(this.windUp, () => {
                this.windingUp = false;
                this.restoreTint();
                if (this.dead || !this.active) return;
                this.dropBomb();
                this.nextDrop = this.scene.time.now + this.dropRate;
            });
        }
    }

    // Gentle hover: drift toward the player's x at 60px/s, and hold
    // altitude around the spawn height with a sine bob. The spring term
    // keeps the bob from wandering off over a long fight.
    hover(time) {
        if (this.player) {
            const dx = this.player.x - this.x;
            if (Math.abs(dx) > 30) {
                this.setVelocityX(Math.sign(dx) * this.driftSpeed);
            } else {
                this.setVelocityX(0);
            }
        }
        const bob = Math.sin(time / 700) * 30;
        const spring = (this.baseY - this.y) * 2;
        this.setVelocityY(Phaser.Math.Clamp(spring + bob, -120, 120));
        this.flipX = this.player ? this.player.x < this.x : false;
    }

    // One bomb straight down — same projectile setup as the turret's aimed
    // shots (Bullet + 'fireballsheet' + softBulletGroup, 4s lifespan so
    // shots can't fall forever). It passes through platforms (the group
    // is walls: false, like the turret's), so the dodge is horizontal,
    // not hiding under cover.
    dropBomb() {
        if (this.isRemote) return; // puppets never shoot (Part 2)
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
        const bomb = new Bullet(this.scene, this.x, this.y + 24, 'fireballsheet');
        sm.softBulletGroup.add(bomb);
        bomb.play('fireball');
        this.scene.physics.velocityFromAngle(90, 380, bomb.body.velocity);
        // Part 2: the host also emits the shot so non-hosts spawn the
        // same bomb locally.
        this.emitEnemyShot(bomb);
        // 4s lifespan (same as the turret's/boss's) so bombs can't fall forever.
        this.scene.time.delayedCall(4000, () => {
            if (bomb.active) bomb.destroy();
        });
    }
}
