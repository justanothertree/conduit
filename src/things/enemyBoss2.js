import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";
import GameManager from "./GameManager.js";

// WORLD 1's boss — the Iron Warden, holding the arena at the end of World 1.
//
// Distinct from the Flowline boss (which does aimed spreads, broken
// spirals, shockwave rings and a chasing leap): the Warden is a siege
// engine with its own pattern language —
//   Phase 1 (> 66%): "sweep rows" — 3 sequential horizontal rows of
//     falling fireballs, each row with a 2-wide gap that SHIFTS per row,
//     so the player must keep moving between safe slots.
//   Phase 2 (33–66%): alternates sweep rows with "burst + ring" — a fast
//     3-round aimed burst, then a slow radial ring whose gap faces the
//     player (standing in the gap is safe for that beat).
//   Phase 3 (< 33%): alternates "pinwheel" (a rotating emitter streaming
//     10 fireballs) with "slam" — a telegraphed leap at the player that
//     fires two ground-hugging shockwaves on landing (jump to dodge).
// Phase transitions are a 1.2s OVERLOAD: the Warden stops, flashes white,
// and is a free-hit window — a breather beat instead of a shockwave.
//
// Phone readability: every volley is telegraphed (yellow flash, same
// convention as the turret/Flowline boss), every pattern leaves a dodgeable
// gap, concurrent projectiles are capped at ~36 like the Flowline boss.
//
// Every attack reuses existing mechanics: contact damage via the base
// playerCollide, fireballs via the same Bullet/'fireballsheet'/
// softBulletGroup pattern as the turret's aimed shots (4s lifespan so they
// clean up), and the base enemy's setVelocityY jump for the slam. No new
// weapon systems, no movement/physics retuning — phase speeds (140/200/260)
// and the leap velocity are enemy AI values, same class as the Flowline
// boss's.
//
// Per-run set piece: spawnBoss2 never re-registers for respawn. The big HP
// bar lives in PlayerUI; the boss shows it on activate and hides it on
// death/deactivate. Delayed volleys are generation-guarded so a stale
// wind-up from before a death/deactivate can never fire.
export default class Boss2 extends BaseEnemy {
    static MAX_HEALTH = 600;
    static MAX_SHOTS = 36; // concurrent boss projectiles — phone-friendly cap

    constructor(scene, x, y, health = Boss2.MAX_HEALTH) {
        super(scene, x, y, 'duck', health);
        this.name = 'boss2';

        this.setScale(.8);
        this.setTint(0xff33cc); // magenta — reads as "boss", distinct from the purple Flowline boss

        this.damage = 10;
        this.speed = 140;
        this.phase = 1;
        this.fireRate = 2800;
        this.nextFireball = 0;
        this.volleyKind = 0;    // alternates the two patterns in phases 2/3
        this.windingUp = false; // telegraph in progress — no new volley yet
        this.overloading = false; // phase-transition breather — no attacks, free hits
        this.slamArmed = false; // slam leap in flight — fire waves on landing
        this.wasAirborne = false;
        this.gen = 0;           // generation guard for delayed volleys
        this.bossShots = [];    // own projectile refs, for the MAX_SHOTS cap
        this.arenaLeft = 0;     // computed in activate() from the walls layer
        this.arenaRight = 0;
        this.groundTop = 0;
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like Bat/Duck/Sunman do in init().
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        const onGround = this.body?.blocked.down || this.body?.touching.down;
        // Slam landing: the leap was telegraphed; the shockwaves fire the
        // moment the boss touches down again.
        if (this.slamArmed && onGround && this.wasAirborne) {
            this.slamArmed = false;
            this.fireGroundWaves();
        }
        this.wasAirborne = !onGround;
        if (this.overloading) {
            this.setVelocityX(0);
            this.updateBossBarVisibility();
            return;
        }
        this.facePlayer();
        this.clampToArena();    // bounce/turn at the arena walls
        this.patrol(time);      // inherited ground patrol (uses phase speed)
        this.tickAttacks();
        this.updateBossBarVisibility();
    }

    facePlayer() {
        if (!this.player) return;
        const dx = this.player.x - this.x;
        if (Math.abs(dx) > 40) this.direction = Math.sign(dx);
        this.flipX = this.direction > 0;
    }

    clampToArena() {
        if (this.arenaLeft && this.x < this.arenaLeft + 48) {
            this.direction = 1;
        } else if (this.arenaRight && this.x > this.arenaRight - 48) {
            this.direction = -1;
        }
    }

    activate(x, y, health = Boss2.MAX_HEALTH) {
        super.activate(x, y, health);
        this.setScale(.8);
        this.setTint(0xff33cc); // activate() clears tint
        this.scaleCollision(64, 64); // body exists now (in the physics world)
        // Spawn fix (same class as the Flowline boss): snap onto solid
        // ground below the spawn point and derive the arena bounds from the
        // walls layer, so no tilemap edits are needed.
        this.snapToGround(x, y);
        this.gen++; // invalidate any delayed volleys from a previous life
        this.phase = 1;
        this.fireRate = 2800;
        this.speed = 140;
        this.volleyKind = 0;
        this.windingUp = false;
        this.overloading = false;
        this.slamArmed = false;
        this.bossShots = [];
        this.nextFireball = this.scene.time.now + 1800; // a beat before it starts
        this.barVisible = false;
        return true;
    }

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
            this.setPosition(3808, 2170); // mid-arena, just above the floor
            this.setVelocity(0, 0);
            this.groundTop = 2240;
            this.arenaLeft = 3456;
            this.arenaRight = 4096;
            return;
        }
        const halfH = (this.body?.height ?? 64) / 2;
        this.setPosition(sx, groundTop - halfH - 2);
        this.setVelocity(0, 0);
        this.groundTop = groundTop;
        this.computeArenaBounds(sx, groundTop);
    }

    computeArenaBounds(sx, groundTop) {
        const walls = this.scene.walls;
        // Probe 3 tiles above the floor: the arena's left wall has a ground
        // doorway (rows 68-69 are open), so probing at walking height would
        // scan straight out into the antechamber.
        const probeY = groundTop - 96;
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
            this.fireRate = 2400;
            this.speed = 200;
        } else {
            this.fireRate = 2000;
            this.speed = 260;
        }
        this.startOverload();
    }

    // Phase-transition breather: the Warden stops for 1.2s, flashes white,
    // and takes free hits — a readable "phase changed" beat that is NOT
    // another shockwave ring (the Flowline boss already does that).
    startOverload() {
        if (this.dead) return;
        const g = this.gen;
        this.overloading = true;
        this.windingUp = false;
        this.setTint(0xffffff);
        this.setVelocity(0, 0);
        const now = this.scene.time.now;
        this.nextFireball = Math.max(this.nextFireball, now + 2200);
        this.scene.time.delayedCall(1200, () => {
            if (g !== this.gen || this.dead || !this.active) return;
            this.overloading = false;
            this.restoreTint();
        });
    }

    // After BaseEnemy's hit-flash clears the tint, restore the phase color.
    restoreTint() {
        if (this.overloading) return; // don't cut the white overload flash short
        this.setTint(this.phase === 2 ? 0xff8800 : this.phase === 3 ? 0xff2222 : 0xff33cc);
    }

    tickAttacks() {
        if (this.dead || this.stunned || this.overloading || !this.player) return;
        // Use scene.time.now (not the preUpdate `time` param, which is
        // game.loop.time) so the clock matches activate() and doesn't cause
        // instant frame-1 fireballs or unpause bursts.
        const now = this.scene.time.now;
        this.updatePhase();
        // updatePhase may have started an overload this frame — don't
        // begin a volley into the breather beat.
        if (this.overloading) return;
        if (now >= this.nextFireball && !this.windingUp && this.distanceToPlayer() < 900) {
            this.nextFireball = now + this.fireRate;
            this.startVolley();
        }
    }

    // Telegraph first (yellow flash, same convention as the turret and the
    // Flowline boss), then fire. The boss keeps its pattern choice local —
    // phases 2 and 3 alternate two volleys so the fight reads as
    // bullet-hell rather than one repeated shot.
    startVolley() {
        let fire;
        if (this.phase === 1) {
            fire = () => this.startSweepRows();
        } else if (this.phase === 2) {
            fire = this.volleyKind % 2 === 0
                ? () => this.startSweepRows()
                : () => this.startBurstRing();
        } else {
            fire = this.volleyKind % 2 === 0
                ? () => this.startPinwheel()
                : () => this.startSlam();
        }
        this.volleyKind++;
        this.windingUp = true;
        this.setTint(0xfff176);
        const g = this.gen;
        this.scene.time.delayedCall(600, () => {
            this.windingUp = false;
            this.restoreTint();
            // Abort if a phase change started an overload mid-windup — the
            // breather beat shouldn't have a volley landing in it.
            if (g !== this.gen || this.overloading || this.dead || !this.active || !this.player) return;
            fire();
        });
    }

    // Phase 1 (+ phase 2 alternate): 3 rows of falling fireballs. Each row
    // spans the arena with a 2-wide gap that SHIFTS per row — the player
    // must keep moving between safe slots. Dodgeable by construction: two
    // adjacent columns are always empty in every row.
    startSweepRows() {
        const g = this.gen;
        const left = (this.arenaLeft || this.x - 300) + 40;
        const right = (this.arenaRight || this.x + 300) - 40;
        const cols = 7;
        const y = this.y - 260;
        for (let r = 0; r < 3; r++) {
            const gap = 1 + r * 2; // gap columns shift: 1-2, 3-4, 5-6
            this.scene.time.delayedCall(r * 750, () => {
                if (g !== this.gen || this.dead || !this.active) return;
                for (let i = 0; i < cols; i++) {
                    if (i === gap || i === gap + 1) continue;
                    const bx = left + (i / (cols - 1)) * (right - left);
                    this.scene.time.delayedCall(i * 90, () => {
                        if (g !== this.gen || this.dead || !this.active) return;
                        this.fireBulletAt(bx, y, 90, 340);
                    });
                }
            });
        }
    }

    // Phase 2 alternate: a fast 3-round aimed burst, then a slow radial
    // ring whose gap faces the player — standing in the gap is safe for
    // that beat (same fair convention as the Flowline boss's ring).
    startBurstRing() {
        const g = this.gen;
        const aimed = Phaser.Math.RadToDeg(
            Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y));
        for (let i = 0; i < 3; i++) {
            this.scene.time.delayedCall(i * 180, () => {
                if (g !== this.gen || this.dead || !this.active || !this.player) return;
                this.fireBullet(aimed + (i - 1) * 8, 520);
            });
        }
        this.scene.time.delayedCall(700, () => {
            if (g !== this.gen || this.dead || !this.active || !this.player) return;
            const gapAt = Phaser.Math.RadToDeg(
                Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y));
            for (let i = 0; i < 10; i++) {
                const a = i * 36;
                if (Math.abs(Phaser.Math.Angle.WrapDegrees(a - gapAt)) < 40) continue;
                this.fireBullet(a, 280);
            }
        });
    }

    // Phase 3 alternate: a rotating emitter streaming 10 fireballs — the
    // spiral arms sweep around, so the safe lane keeps moving.
    startPinwheel() {
        const g = this.gen;
        const base = Phaser.Math.Between(0, 359);
        for (let i = 0; i < 10; i++) {
            this.scene.time.delayedCall(i * 130, () => {
                if (g !== this.gen || this.dead || !this.active) return;
                this.fireBullet(base + i * 36, 320);
            });
        }
    }

    // Phase 3 alternate: telegraphed leap at the player; on landing, two
    // ground-hugging shockwaves roll left and right (jump to dodge). The
    // leap itself is the second half of the telegraph — the yellow flash
    // is the warning.
    startSlam() {
        if (!this.player || this.dead) return;
        const dx = this.player.x - this.x;
        this.slamArmed = true;
        this.wasAirborne = false;
        this.setVelocity(Math.sign(dx) * 480, -520);
    }

    fireGroundWaves() {
        const g = this.gen;
        const y = (this.groundTop || this.y + 40) - 24;
        for (const dir of [0, 180]) {
            for (let i = 0; i < 5; i++) {
                this.scene.time.delayedCall(i * 100, () => {
                    if (g !== this.gen || this.dead || !this.active) return;
                    this.fireBulletAt(this.x, y, dir, 400);
                });
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

    // One fireball — same projectile setup as the turret's aimed shots and
    // the Flowline boss (Bullet + 'fireballsheet' + softBulletGroup, 4s
    // lifespan so shots can't fly forever). Skipped when the
    // concurrent-projectile cap is hit.
    fireBullet(angleDeg, speed = 450) {
        this.fireBulletAt(this.x, this.y, angleDeg, speed);
    }

    fireBulletAt(bx, by, angleDeg, speed) {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup) return;
        this.pruneShots();
        if (this.bossShots.length >= Boss2.MAX_SHOTS) return;
        this.ensureFireballAnim();
        const bullet = new Bullet(this.scene, bx, by, 'fireballsheet');
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
        // flag, mirroring flags.bossRewardPaid); repeat kills pay a 50-money
        // consolation. player.updateMoney calls GameManager.save(), so the
        // flag persists with the payout.
        const reward = GameManager.flags.boss2RewardPaid ? 50 : 500;
        GameManager.flags.boss2RewardPaid = true;
        this.scene.player?.playerUI?.hideBossBar();
        this.barVisible = false;
        this.gen++; // invalidate any in-flight delayed volleys
        this.dead = true;
        player.updateMoney(reward);
        this.dropFirstKillLoot();
        this.emit('die', player);
        this.deactivate();
    }

    // First-kill loot: two persistent shards plus a fireball weapon card,
    // dropped near the arena. The shards use 'w1boss-' ids so they persist
    // via GameManager.collectedItems without polluting the ◆ n/12 World 1
    // counter (World1 counts only 'w1-' ids) — same convention as the
    // Flowline boss's 'bossloot-' shards.
    dropFirstKillLoot() {
        if (GameManager.flags.boss2LootDropped) return;
        GameManager.flags.boss2LootDropped = true;
        GameManager.save();
        const sm = this.scene.spawnManager;
        if (!sm) return;
        const mkShardObj = (id) => ({ properties: [{ name: 'id', type: 'string', value: id }] });
        sm.spawnShard(this.x - 90, this.y - 60, mkShardObj('w1boss-1'));
        sm.spawnShard(this.x + 90, this.y - 60, mkShardObj('w1boss-2'));
        sm.spawnCard(this.x, this.y - 100, {
            properties: [{ name: 'type', type: 'string', value: 'CardFireball' }],
        });
    }

    deactivate() {
        this.gen++; // invalidate any in-flight delayed volleys
        this.barVisible = false;
        this.windingUp = false;
        this.overloading = false;
        this.slamArmed = false;
        this.scene?.player?.playerUI?.hideBossBar();
        super.deactivate();
    }
}
