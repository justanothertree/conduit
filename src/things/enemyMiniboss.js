import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js";
import GameManager from "./GameManager.js";

// WORLD 1's mini-boss: the Bombardier, an oversized bomber guarding the
// antechamber before the Iron Warden. The bomber area's gatekeeper —
// kill it to pass. Smaller and faster than the two big bosses (250 HP,
// two phases), but a real bullet-hell fight, not a big enemy: telegraphed
// bomb spreads plus aimed volleys, a boss HP bar, first-kill loot, and
// the same rematch mode as the big bosses.
//
// Reuses existing mechanics only: the bomber's hover (drift + sine bob +
// spring), the turret's aimed fireballs (Bullet + 'fireballsheet' +
// softBulletGroup, 4s lifespan, 36-bullet cap), the boss bar + rematch
// trigger + loot conventions from enemyBoss/enemyBoss2. No new weapon
// systems, no movement/physics retuning — the hover drift and bob are
// this enemy's own AI values, same class as the turret's fire rate.
export default class Miniboss extends BaseEnemy {
    static MAX_HEALTH = 250;

    constructor(scene, x, y, health = Miniboss.MAX_HEALTH) {
        super(scene, x, y, 'bat', health);

        this.name = 'miniboss';
        this.damage = 4;          // contact damage (base playerCollide)
        this.driftSpeed = 60;     // px/s — slow hover toward the player
        this.dropRate = 3200;     // ms between bomb drops (phase 1)
        this.dropRateP2 = 2200;   // ms between bomb drops (phase 2)
        this.volleyRate = 2600;   // ms between aimed fans (phase 2 only)
        this.windUp = 400;        // ms telegraph flash before an attack
        this.dropRange = 800;     // px — only attacks when the player is near
        this.nextDrop = 0;
        this.nextVolley = 0;
        this.windingUp = false;
        this.baseY = y;           // hover anchor — set properly in activate()
        this.arenaLeft = x - 160; // stays in the antechamber
        this.arenaRight = x + 160;
        this.phase = 1;
        this.rematch = false;
        this.rateMult = 1;        // rematch: faster attacks (×0.7)
        this.shotSpeedMult = 1;   // rematch: faster bullets (×1.15)
        this.gen = 0;             // bumped in deactivate(): invalidates
                                  // pending telegraph completions
        this.shots = [];          // live bullets, capped at 36 like the bosses
        this.barVisible = false;
        this.setTint(0xff3355);   // crimson — bigger, angrier bomber
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Turret does.
    }

    activate(x, y, health = Miniboss.MAX_HEALTH, rematch = false) {
        super.activate(x, y, health);
        this.setScale(1.5); // visibly bigger than a bomber
        this.setTint(0xff3355); // activate() clears tint
        this.scaleCollision(64, 64); // body exists now (in the physics world)
        this.body.allowGravity = false;
        this.setVelocity(0, 0);
        this.baseY = y;
        this.arenaLeft = x - 160;
        this.arenaRight = x + 160;
        // Rematch (hard mode): faster attacks and faster bullets. HP and
        // hover speeds are deliberately unchanged — the fight gets
        // denser, not tankier or quicker.
        this.rematch = rematch;
        this.rateMult = rematch ? 0.7 : 1;
        this.shotSpeedMult = rematch ? 1.15 : 1;
        if (rematch) {
            const label = this.scene.add.text(x, y - 130, 'REMATCH', {
                fontSize: '28px',
                color: '#ff5555',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 5,
            }).setOrigin(.5);
            this.scene.tweens.add({
                targets: label,
                alpha: 0,
                delay: 1500,
                duration: 600,
                onComplete: () => label.destroy(),
            });
        }
        this.gen++; // invalidate any delayed telegraphs from a previous life
        this.phase = 1;
        this.shots = [];
        this.nextDrop = this.scene.time.now + 1500; // a beat before it starts
        this.nextVolley = this.scene.time.now + 4000;
        this.windingUp = false;
        this.barVisible = false;
        return true;
    }

    // After the base hit-flash clears the tint, restore the crimson.
    restoreTint() {
        this.setTint(0xff3355);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        this.hover(time);
        this.tickAttacks();
        this.updateBossBarVisibility();
    }

    // Gentle hover, same math as the bomber: drift toward the player's x
    // at 60px/s, hold altitude around the spawn height with a sine bob.
    // Clamped to the antechamber so it can't drift back into the den.
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
        if (this.x < this.arenaLeft) this.setVelocityX(Math.max(this.body.velocity.x, 0));
        if (this.x > this.arenaRight) this.setVelocityX(Math.min(this.body.velocity.x, 0));
        this.flipX = this.player ? this.player.x < this.x : false;
    }

    updatePhase() {
        const frac = this.health / this.maxHealth;
        this.phase = frac > 0.5 ? 1 : 2;
    }

    tickAttacks() {
        // Use scene.time.now (not the preUpdate `time` param, which is
        // game.loop.time) so the clock matches activate() and doesn't
        // cause instant frame-1 attacks or unpause bursts.
        const now = this.scene.time.now;
        this.updatePhase();
        if (this.windingUp || !this.player) return;
        if (this.distanceToPlayer() > this.dropRange) return;

        if (now >= this.nextDrop) {
            const rate = (this.phase === 2 ? this.dropRateP2 : this.dropRate) * this.rateMult;
            this.nextDrop = now + rate;
            this.startBombSpread();
        } else if (this.phase === 2 && now >= this.nextVolley) {
            this.nextVolley = now + this.volleyRate * this.rateMult;
            this.startFan();
        }
    }

    // Telegraph first (yellow flash, same convention as the turret and the
    // bosses), then attack. The generation check goes FIRST in the
    // callback: a stale telegraph from before a death/deactivate must not
    // fire — that attack belongs to a newer life now.
    telegraph(fire) {
        this.windingUp = true;
        this.setTint(0xfff176);
        const g = this.gen;
        this.scene.time.delayedCall(this.windUp, () => {
            if (g !== this.gen || this.dead || !this.active) return;
            this.windingUp = false;
            this.restoreTint();
            if (this.dead || !this.active) return;
            fire();
        });
    }

    startBombSpread() {
        this.telegraph(() => this.dropBombs());
    }

    startFan() {
        this.telegraph(() => this.fireFan());
    }

    // Three bombs at once — straight down plus one each side at ±25°,
    // same projectile setup as the bomber's drop (Bullet + 'fireballsheet'
    // + softBulletGroup, 4s lifespan). The dodge is horizontal, same as
    // the bomber's: the bombs fall where the player was.
    dropBombs() {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup || !this.player) return;
        this.ensureFireballAnim();
        for (const angleDeg of [90, 65, 115]) {
            const bomb = new Bullet(this.scene, this.x, this.y + 24, 'fireballsheet');
            sm.softBulletGroup.add(bomb);
            bomb.play('fireball');
            this.scene.physics.velocityFromAngle(angleDeg, 380 * this.shotSpeedMult, bomb.body.velocity);
            this.trackShot(bomb);
        }
    }

    // Phase 2: a 5-bullet aimed fan at the player, same pattern as the
    // turret's aimed shots. Narrow spread, dodgeable gaps between shots.
    fireFan() {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup || !this.player) return;
        this.ensureFireballAnim();
        const base = Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y);
        for (let i = -2; i <= 2; i++) {
            const angleDeg = Phaser.Math.RadToDeg(base) + i * 12;
            const bullet = new Bullet(this.scene, this.x, this.y, 'fireballsheet');
            sm.softBulletGroup.add(bullet);
            bullet.play('fireball');
            this.scene.physics.velocityFromAngle(angleDeg, 450 * this.shotSpeedMult, bullet.body.velocity);
            this.trackShot(bullet);
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

    // 36-bullet cap, same as the big bosses: prune dead shots, then skip
    // firing while at the cap. The 4s lifespan keeps the list short.
    trackShot(bullet) {
        this.shots = this.shots.filter((b) => b.active);
        if (this.shots.length >= 36) {
            bullet.destroy();
            return;
        }
        this.shots.push(bullet);
        this.scene.time.delayedCall(4000, () => {
            if (bullet.active) bullet.destroy();
        });
    }

    // Show the boss HP bar only while the player is within ~900px.
    // Guarded by barVisible so show/hide aren't called every frame
    // (showBossBar rebuilds the bar objects).
    updateBossBarVisibility() {
        const ui = this.scene.player?.playerUI;
        if (!ui) return;
        const close = this.player && this.distanceToPlayer() < 900;
        if (close && !this.barVisible) {
            ui.showBossBar(this, 'MINI-BOSS');
            this.barVisible = true;
        } else if (!close && this.barVisible) {
            ui.hideBossBar();
            this.barVisible = false;
        }
    }

    die(player) {
        // Mini-boss bounty: 250 on the first kill of the save (one-time
        // flag, mirroring flags.bossRewardPaid); a hard-mode rematch pays
        // 100; any other repeat kill pays a 50-money consolation.
        // player.updateMoney calls GameManager.save(), so the flag persists
        // with the payout.
        const reward = this.rematch ? 100 : (GameManager.flags.minibossRewardPaid ? 50 : 250);
        GameManager.flags.minibossRewardPaid = true;
        this.scene.player?.playerUI?.hideBossBar();
        this.barVisible = false;
        this.gen++; // invalidate any in-flight telegraphs
        this.dead = true;
        player.updateMoney(reward);
        this.dropFirstKillLoot();
        // Rematch: leaving the arena and coming back re-spawns the boss in
        // hard mode (see armRematchTrigger). First-kill loot is flag-guarded,
        // so a rematch can never pay it twice.
        this.armRematchTrigger(this.x, this.y,
            () => this.scene.spawnManager?.spawnMiniboss(this.x, this.y));
        this.emit('die', player);
        this.deactivate();
    }

    // First-kill loot: two persistent shards plus a mid-tier weapon card,
    // dropped near the arena. The shards use 'miniboss-' ids so they
    // persist via GameManager.collectedItems without polluting the ◆ n/12
    // World 1 counter (World1 counts only 'w1-' ids, excluding
    // 'w1boss-') — same convention as the Flowline boss's 'bossloot-'
    // shards.
    //
    // The flag is set and saved only AFTER the spawns succeed: if the
    // spawnManager is missing, the flag stays unset and the loot is retried
    // on the next kill instead of being lost forever with a burned flag.
    dropFirstKillLoot() {
        if (GameManager.flags.minibossLootDropped) return;
        const sm = this.scene.spawnManager;
        if (!sm) return;
        const mkShardObj = (id) => ({ properties: [{ name: 'id', type: 'string', value: id }] });
        const p1 = this.nudgeDropPoint(this.x - 90, this.y - 60);
        const p2 = this.nudgeDropPoint(this.x + 90, this.y - 60);
        const p3 = this.nudgeDropPoint(this.x, this.y - 100);
        sm.spawnShard(p1.x, p1.y, mkShardObj('miniboss-1'));
        sm.spawnShard(p2.x, p2.y, mkShardObj('miniboss-2'));
        sm.spawnCard(p3.x, p3.y, {
            properties: [{ name: 'type', type: 'string', value: 'CardCrystal' }],
        });
        GameManager.flags.minibossLootDropped = true;
        GameManager.save();
    }

    deactivate() {
        this.gen++; // invalidate any in-flight telegraphs
        this.barVisible = false;
        this.windingUp = false;
        this.scene?.player?.playerUI?.hideBossBar();
        super.deactivate();
    }
}
