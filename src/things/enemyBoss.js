import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";
import GameManager from "./GameManager.js";

// FLOWLINE's first real boss — a bigger, meaner duck holding the arena at
// the end of Flowline, replacing the old scaled-duck mini-boss.
//
// Boss HP 500 (documented where it's spawned). Bullet-hell direction:
// every volley is telegraphed (yellow flash, same convention as the turret),
// every pattern leaves a dodgeable gap, and concurrent projectiles are
// capped so phones stay readable and fast.
//
// Phases keyed to HP fraction:
//   Phase 1 (> 66%): patrols/chases in the arena, telegraphed 5-bullet
//     aimed spread every 2.5s
//   Phase 2 (33–66%): alternates the aimed spread with a "broken spiral"
//     (12 bullets streamed with a missing arm = dodgeable gap), moves faster
//   Phase 3 (< 33%): enraged — wide 7-bullet fan alternating with a denser
//     broken spiral, fastest chase, leaps at the player
// Each phase transition fires a one-time telegraphed ring with its gap
// facing the player (standing still is safe for that one beat).
//
// Every attack reuses existing mechanics: contact damage via the base
// playerCollide, fireballs via the same Bullet/'fireballsheet'/
// softBulletGroup pattern as the turret's aimed shots (4s lifespan so they
// clean up), and the base enemy's setVelocityY jump for the leap. No new
// weapon systems, no movement/physics retuning — phase speeds (160/220/300)
// and the leap velocity are exactly what they were.
//
// Per-run set piece like the mini-boss was: spawnBoss never re-registers
// for respawn. The big HP bar lives in PlayerUI; the boss shows it on
// activate and hides it on death/deactivate.
export default class Boss extends BaseEnemy {
    static MAX_HEALTH = 500;
    static MAX_SHOTS = 36; // concurrent boss projectiles — phone-friendly cap

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
        this.volleyKind = 0;   // alternates the two patterns in phases 2/3
        this.windingUp = false; // telegraph in progress — no new volley yet
        this.bossShots = [];    // own projectile refs, for the MAX_SHOTS cap
        this.arenaLeft = 0;     // computed in activate() from the walls layer
        this.arenaRight = 0;
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like Bat/Duck/Sunman do in init().
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        this.facePlayer();
        this.clampToArena();    // bounce/turn at the arena walls
        this.patrol(time);      // inherited ground patrol (uses phase speed)
        this.tickAttacks();
        this.updateBossBarVisibility();
    }

    // Face the player without touching patrol's speed logic.
    facePlayer() {
        if (!this.player) return;
        const dx = this.player.x - this.x;
        if (Math.abs(dx) > 40) this.direction = Math.sign(dx);
        this.flipX = this.direction > 0;
    }

    // Turn the boss around when it reaches the arena bounds computed in
    // activate(). The base patrol already turns on real walls/ledges; this
    // is the belt-and-braces so it never drifts out of the arena.
    clampToArena() {
        if (this.arenaLeft && this.x < this.arenaLeft + 48) {
            this.direction = 1;
        } else if (this.arenaRight && this.x > this.arenaRight - 48) {
            this.direction = -1;
        }
    }

    activate(x, y, health = Boss.MAX_HEALTH) {
        super.activate(x, y, health);
        this.setScale(.75);
        this.setTint(0xcc55ff); // activate() clears tint
        this.scaleCollision(60, 60); // body exists now (in the physics world)
        // Spawn fix: the boss used to spawn in mid-air, fall through the
        // arena floor and wedge itself in a corner. Snap it onto solid
        // ground below the spawn point (computed from the walls layer, so no
        // tilemap edits needed) and derive the arena bounds for movement.
        this.snapToGround(x, y);
        this.phase = 1;
        this.fireRate = 2500;
        this.speed = 160;
        this.volleyKind = 0;
        this.windingUp = false;
        this.bossShots = [];
        this.nextFireball = this.scene.time.now + 1500; // a beat before it starts
        this.nextLeap = this.scene.time.now + 4000;
        // Bar visibility is distance-gated in updateBossBarVisibility (called
        // from preUpdate) — the fight stays live outside 900px, only the bar
        // shows/hides.
        this.barVisible = false;
        return true;
    }

    // Find the first solid tile below the spawn point and rest the boss on
    // top of it; then scan the walls layer at walking height to find the
    // arena's left/right walls. Falls back to a hardcoded safe mid-arena
    // position if the scan ever finds nothing.
    snapToGround(sx, sy) {
        const walls = this.scene.walls;
        let groundTop = null;
        if (walls) {
            for (let py = sy; py < sy + 900; py += 8) {
                const tile = walls.getTileAtWorldXY(sx, py);
                if (tile && tile.index !== -1) {
                    groundTop = tile.pixelY;
                    break;
                }
            }
        }
        if (groundTop === null) {
            this.setPosition(4704, 2656); // mid-arena, just above the floor
            this.setVelocity(0, 0);
            this.arenaLeft = 4416;
            this.arenaRight = 4960;
            return;
        }
        const halfH = (this.body?.height ?? 60) / 2;
        this.setPosition(sx, groundTop - halfH - 2);
        this.setVelocity(0, 0);
        this.computeArenaBounds(sx, groundTop);
    }

    computeArenaBounds(sx, groundTop) {
        const walls = this.scene.walls;
        const probeY = groundTop - 16; // walking height, below the cover platforms
        const tileSize = 32;
        let left = sx - 480;
        let right = sx + 480;
        if (walls) {
            for (let px = sx; px > sx - 900; px -= tileSize) {
                const tile = walls.getTileAtWorldXY(px, probeY);
                if (tile && tile.index !== -1) { left = tile.pixelX + tileSize; break; }
            }
            for (let px = sx; px < sx + 900; px += tileSize) {
                const tile = walls.getTileAtWorldXY(px, probeY);
                if (tile && tile.index !== -1) { right = tile.pixelX; break; }
            }
        }
        this.arenaLeft = left;
        this.arenaRight = right;
    }

    // Show the big purple HP bar only while the player is within ~900px of
    // the boss. Guarded by barVisible so show/hide aren't called every frame
    // (showBossBar rebuilds the bar objects).
    updateBossBarVisibility() {
        const ui = this.scene.player?.playerUI;
        if (!ui) return;
        const close = this.player && this.distanceToPlayer() < 900;
        if (close && !this.barVisible) {
            ui.showBossBar(this);
            this.barVisible = true;
        } else if (!close && this.barVisible) {
            ui.hideBossBar();
            this.barVisible = false;
        }
    }

    updatePhase() {
        const frac = this.health / this.maxHealth;
        const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
        if (phase === this.phase) return;
        this.phase = phase;
        if (phase === 2) {
            this.fireRate = 2200;
            this.speed = 220;
        } else {
            this.fireRate = 1600;
            this.speed = 300;
        }
        // Don't cut the telegraph flash short: if a volley is winding up,
        // its delayedCall calls restoreTint() when the wind-up finishes, and
        // restoreTint() reads this.phase live — so the new phase's tint is
        // restored then. Restoring here would kill the yellow warning early
        // while the volley still fires.
        if (!this.windingUp) this.restoreTint();
        // Phase-change shockwave: a telegraphed ring whose gap faces the
        // player (standing still is safe for this one beat) — a readable
        // bullet-hell moment that marks the transition.
        const now = this.scene.time.now;
        this.nextFireball = Math.max(this.nextFireball, now + 1200);
        this.phaseBurst();
    }

    // After BaseEnemy's hit-flash clears the tint, restore the phase color.
    restoreTint() {
        this.setTint(this.phase === 2 ? 0xff8800 : this.phase === 3 ? 0xff2222 : 0xcc55ff);
    }

    tickAttacks() {
        if (this.dead || this.stunned || !this.player) return;
        // Use scene.time.now (not the preUpdate `time` param, which is
        // game.loop.time) so the clock matches activate() and doesn't cause
        // instant frame-1 fireballs or unpause bursts.
        const now = this.scene.time.now;
        this.updatePhase();
        if (now >= this.nextFireball && !this.windingUp && this.distanceToPlayer() < 900) {
            this.nextFireball = now + this.fireRate;
            this.startVolley();
        }
        const onGround = this.body?.blocked.down || this.body?.touching.down;
        if (this.phase === 3 && onGround && now >= this.nextLeap) {
            this.nextLeap = now + 4000;
            const dx = this.player.x - this.x;
            this.setVelocity(Math.sign(dx) * 500, -550);
        }
    }

    // Phase-appropriate pattern. Phases 2 and 3 alternate two volleys so the
    // fight reads as bullet-hell rather than one repeated shot.
    pickPattern() {
        const aimed = Phaser.Math.RadToDeg(
            Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y));
        if (this.phase === 1) {
            return { kind: 'spread', count: 5, stepDeg: 14, speed: 450, windUp: 400, base: aimed };
        }
        if (this.phase === 2) {
            if (this.volleyKind % 2 === 0) {
                return { kind: 'spread', count: 5, stepDeg: 14, speed: 450, windUp: 500, base: aimed };
            }
            return { kind: 'spiral', count: 12, stepDeg: 30, skipEvery: 4, skipMod: 2, speed: 380, windUp: 500, base: aimed, interval: 110 };
        }
        if (this.volleyKind % 2 === 0) {
            return { kind: 'spread', count: 7, stepDeg: 12, speed: 450, windUp: 450, base: aimed };
        }
        return { kind: 'spiral', count: 16, stepDeg: 24, skipEvery: 4, skipMod: 2, speed: 400, windUp: 450, base: aimed, interval: 90 };
    }

    // Telegraph first (yellow flash, same convention as the turret), then
    // fire. The boss keeps moving during the telegraph — the flash is the
    // warning, not a freeze.
    startVolley() {
        const pattern = this.pickPattern();
        this.volleyKind++;
        this.windingUp = true;
        this.setTint(0xfff176);
        this.scene.time.delayedCall(pattern.windUp, () => {
            this.windingUp = false;
            this.restoreTint();
            if (this.dead || !this.active || !this.player) return;
            this.firePattern(pattern);
        });
    }

    phaseBurst() {
        if (!this.player || this.dead) return;
        const gapAt = Phaser.Math.RadToDeg(
            Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y));
        this.windingUp = true;
        this.setTint(0xfff176);
        this.scene.time.delayedCall(600, () => {
            this.windingUp = false;
            this.restoreTint();
            if (this.dead || !this.active || !this.player) return;
            // The ring needs a numeric base — firePattern adds p.base to each
            // angle, and spread/spiral get theirs from pickPattern's `aimed`.
            // Without it every angle is NaN (undefined + number) and the 12
            // bullets freeze at the boss with NaN velocity. The ring covers a
            // full 360° anyway; the dodgeable gap is placed by gapAt/gapHalf.
            this.firePattern({ kind: 'ring', count: 12, speed: 380, base: 0, gapAt, gapHalf: 40 });
        });
    }

    firePattern(p) {
        if (p.kind === 'spread') {
            for (let i = 0; i < p.count; i++) {
                const a = p.base + (i - (p.count - 1) / 2) * p.stepDeg;
                this.fireBullet(a, p.speed);
            }
        } else if (p.kind === 'spiral') {
            // Broken spiral: streamed one bullet at a time, skipping every
            // 4th — the missing arm is the dodgeable gap.
            for (let i = 0; i < p.count; i++) {
                if (i % p.skipEvery === p.skipMod) continue;
                const a = p.base + i * p.stepDeg;
                this.scene.time.delayedCall(i * p.interval, () => {
                    if (this.dead || !this.active) return;
                    this.fireBullet(a, p.speed);
                });
            }
        } else if (p.kind === 'ring') {
            for (let i = 0; i < p.count; i++) {
                const a = p.base + i * (360 / p.count);
                if (Math.abs(Phaser.Math.Angle.WrapDegrees(a - p.gapAt)) < p.gapHalf) continue;
                this.fireBullet(a, p.speed);
            }
        }
    }

    ensureFireballAnim() {
        if (!this.scene.anims.get('fireball')) {
            this.scene.anims.create({
                key: 'fireball',
                frames: this.scene.anims.generateFrameNumbers('fireballsheet', { start: 0, end: 2 }),
                frameRate: 8,
                repeat: -1,
            });
        }
    }

    pruneShots() {
        this.bossShots = this.bossShots.filter((b) => b && b.active);
    }

    // One fireball — same projectile setup as the turret's aimed shots
    // (Bullet + 'fireballsheet' + softBulletGroup, 4s lifespan so shots
    // can't fly forever). Skipped when the concurrent-projectile cap is hit.
    fireBullet(angleDeg, speed = 450) {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup) return;
        this.pruneShots();
        if (this.bossShots.length >= Boss.MAX_SHOTS) return;
        this.ensureFireballAnim();
        const bullet = new Bullet(this.scene, this.x, this.y, 'fireballsheet');
        sm.softBulletGroup.add(bullet);
        bullet.play('fireball');
        this.scene.physics.velocityFromAngle(angleDeg, speed, bullet.body.velocity);
        this.bossShots.push(bullet);
        this.scene.time.delayedCall(4000, () => {
            if (bullet.active) bullet.destroy();
        });
    }

    die(player) {
        // Boss bounty: full 500 only on the first kill of the save (one-time
        // flag, mirroring flags.flowComplete); repeat kills pay a 50-money
        // consolation. player.updateMoney calls GameManager.save(), so the
        // flag persists with the payout.
        const reward = GameManager.flags.bossRewardPaid ? 50 : 500;
        GameManager.flags.bossRewardPaid = true;
        this.scene.player?.playerUI?.hideBossBar();
        this.barVisible = false;
        this.dead = true;
        player.updateMoney(reward);
        this.dropFirstKillLoot();
        this.emit('die', player);
        this.deactivate();
    }

    // First-kill loot: two persistent shards plus one good weapon card,
    // dropped near the arena. The shards use 'bossloot-' ids so they persist
    // via GameManager.collectedItems without polluting the ◆ n/12 Flowline
    // counter (flowShardsFound only counts 'flow-' ids).
    dropFirstKillLoot() {
        if (GameManager.flags.bossLootDropped) return;
        GameManager.flags.bossLootDropped = true;
        GameManager.save();
        const sm = this.scene.spawnManager;
        if (!sm) return;
        const mkShardObj = (id) => ({ properties: [{ name: 'id', type: 'string', value: id }] });
        sm.spawnShard(this.x - 90, this.y - 60, mkShardObj('bossloot-1'));
        sm.spawnShard(this.x + 90, this.y - 60, mkShardObj('bossloot-2'));
        sm.spawnCard(this.x, this.y - 100, {
            properties: [{ name: 'type', type: 'string', value: 'CardFalcion' }],
        });
    }

    deactivate() {
        this.barVisible = false;
        this.windingUp = false;
        this.scene?.player?.playerUI?.hideBossBar();
        super.deactivate();
    }
}
