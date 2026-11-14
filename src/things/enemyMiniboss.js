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
        super(scene, x, y, 'bombardier', health);

        this.name = 'miniboss';
        this.damage = 4;          // contact damage (base playerCollide)
        this.driftSpeed = 60;     // px/s — slow hover toward the player
        this.dropRate = 3200;     // ms between attacks (phase 1)
        this.dropRateP2 = 2200;   // ms between attacks (phase 2)
        this.windUp = 400;        // ms telegraph flash before an attack
        this.dropRange = 800;     // px — only attacks when the player is near
        this.nextAttack = 0;
        this.attackKind = 0;      // rotates the pattern: P1 bombs/sweeper,
                                  // P2 bombs/fan/sweeper
        this.groundTop = 2240;    // antechamber floor top — scanned in activate()
        this.windingUp = false;
        this.baseY = y;           // hover anchor — set properly in activate()
        // Room gate: the antechamber interior is tiles 98-117 (px 3136-
        // 3776, see tools/gen_world1.py). Spawn sits on the room's center
        // tile (108), so ±320px from spawn is the room, centered.
        this.arenaLeft = x - 320;
        this.arenaRight = x + 320;
        this.phase = 1;
        this.rematch = false;
        this.rateMult = 1;        // rematch: faster attacks (×0.7)
        this.shotSpeedMult = 1;   // rematch: faster bullets (×1.15)
        this.gen = 0;             // bumped in deactivate(): invalidates
                                  // pending telegraph completions
        this.shots = [];          // live bullets, capped at 36 like the bosses
        this.barVisible = false;
        // No base tint: the Bombardier art is already a distinct grey/orange
        // machine (a crimson tint would wash it out). Size + art + the
        // boss bar carry its identity against regular bombers.
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Turret does.
    }

    activate(x, y, health = Miniboss.MAX_HEALTH, rematch = false) {
        super.activate(x, y, health);
        // Home position: the first spawn point. Rematches always respawn
        // and center here — the mini-boss used to respawn where it died,
        // drifting a little further from its room every rematch.
        if (this.homeX === undefined) { this.homeX = x; this.homeY = y; }
        // Display size: the new sprite is 284x357 (content ~284x228,
        // transparent top/bottom), vs the old 49x41 bat at scale 1.5
        // (~74x62 on screen). Scale 0.3 puts the content at ~85x68 on
        // screen — the same on-screen presence as before. Hitbox math:
        // scaleCollision takes SOURCE px and the body displays at
        // source x scale, so (280, 240) -> 84x72 on screen, snug to the
        // visible body (the old 64x64 at 1.5x was a generous 96x96).
        this.setScale(0.3);
        this.scaleCollision(280, 240); // body exists now (in the physics world)
        this.body.allowGravity = false;
        this.setVelocity(0, 0);
        this.baseY = y;
        // Room gate (see constructor): spawn is the room's center tile,
        // so ±320px from spawn is the antechamber, centered — recomputed
        // here so rematch respawns (which reuse homeX/homeY) keep it.
        this.arenaLeft = x - 320;
        this.arenaRight = x + 320;
        // Floor level for the ground sweeper: scan the walls layer below
        // the spawn point (same pattern as Boss2.snapToGround). Falls back
        // to the antechamber floor top (row 70) if the scan finds nothing.
        this.groundTop = 2240;
        const walls = this.scene.walls;
        if (walls) {
            for (let py = y; py < y + 900; py += 8) {
                const tile = walls.getTileAtWorldXY(x, py);
                if (tile && tile.index !== -1) { this.groundTop = tile.pixelY; break; }
            }
        }
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
        // A new life gets a fresh intro (the card + lock re-arm on
        // rematch respawns too); any lock left over from a previous life
        // is cleared first.
        this.introShown = false;
        this.unlockBossArena();
        // Opening pause: the player (re)spawns at checkpoint 3 inside
        // this room, so the first attack waits 3s — long enough to get
        // bearings or step out of the room — instead of bombing the
        // respawn point. (Respawn restarts the scene, so activate() runs
        // on every player respawn, first entry included.)
        this.nextAttack = this.scene.time.now + 3000;
        this.attackKind = 0;
        this.windingUp = false;
        this.barVisible = false;
        return true;
    }

    // After the base hit-flash clears the tint, restore it — the
    // Bombardier is untinted (see activate), so this just clears.
    restoreTint() {
        this.setTint();
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        this.hover(time);
        this.tickAttacks();
        this.updateBossBarVisibility();
        // Intro: once the player steps into the room (a step past the
        // west entrance, so the lock barrier appears behind them, never
        // on top of them). The card names the fight plainly — the
        // Bombardier IS the antechamber boss, and the subtitle says so.
        // The lock seals both exits (west entrance + the doorway to the
        // Warden arena) until the boss dies.
        this.tryBossIntro('THE BOMBARDIER', 'BOSS OF THE ANTECHAMBER',
            this.player
                && this.player.x > this.arenaLeft + 96
                && this.player.x < this.arenaRight,
            [
                { x: this.arenaLeft - 32, y: this.groundTop - 740, w: 32, h: 740 },
                { x: this.arenaRight, y: this.groundTop - 740, w: 64, h: 740 },
            ]);
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
        // Only attack while the player is inside the antechamber (the
        // room, spawn ±320px): checkpoint 3 sits inside the 800px attack
        // range, so a respawned player was bombed before they could move.
        // Outside the room the fight disengages — the player can retreat
        // to the den and re-enter on their own terms.
        if (this.player.x < this.arenaLeft || this.player.x > this.arenaRight) return;
        if (now < this.nextAttack) return;

        const rate = (this.phase === 2 ? this.dropRateP2 : this.dropRate) * this.rateMult;
        this.nextAttack = now + rate;
        // Rotating pattern, so no single dodge answers every attack:
        // phase 1 alternates aimed bombs with the ground sweeper, phase 2
        // adds the aimed fan into the rotation.
        const kinds = this.phase === 2
            ? ['bombs', 'fan', 'sweep']
            : ['bombs', 'sweep'];
        const kind = kinds[this.attackKind++ % kinds.length];
        if (kind === 'bombs') this.startBombSpread();
        else if (kind === 'fan') this.startFan();
        else this.startSweeper();
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

    startSweeper() {
        this.telegraph(() => this.fireSweeper());
    }

    // Three bombs at once — the spread centers on the player's ACTUAL
    // position (player.y is the body center, so a crouched player's lower
    // center pulls the bombs down onto them), ±25° around the aim. The
    // old fixed straight-down spread let a crouched player sit in a
    // corner the bombs never reached — the cheese Yaya found. Same
    // projectile setup as the bomber's drop (Bullet + 'fireballsheet' +
    // softBulletGroup, 4s lifespan).
    dropBombs() {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup || !this.player) return;
        this.ensureFireballAnim();
        const base = Phaser.Math.RadToDeg(
            Phaser.Math.Angle.Between(this.x, this.y, this.player.x, this.player.y));
        for (const off of [-25, 0, 25]) {
            const bomb = new Bullet(this.scene, this.x, this.y + 24, 'fireballsheet');
            sm.softBulletGroup.add(bomb);
            bomb.play('fireball');
            this.scene.physics.velocityFromAngle(base + off, 380 * this.shotSpeedMult, bomb.body.velocity);
            this.trackShot(bomb);
        }
    }

    // Phase 2: a 5-bullet aimed fan at the player, same pattern as the
    // turret's aimed shots. Narrow spread, dodgeable gaps between shots.
    // Aimed at the player's center, so it tracks a crouched player too —
    // the crouch doesn't shrink the target, it moves it, and the fan
    // follows.
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

    // Ground-level threat — the other half of the anti-crouch-camp fix.
    // A fireball fired horizontally along the floor toward the player's
    // side at groundTop-24: it overlaps a crouched player's body (the
    // crouched hitbox runs to the floor), so crouching in a corner is no
    // longer safe — the dodge is a jump, not a crouch. softBulletGroup
    // has no gravity, so it holds its line; the 4s lifespan (trackShot)
    // clears it after it crosses the room. One shot, not a wall: the
    // player can jump it or dash through the gap behind it.
    fireSweeper() {
        const sm = this.scene.spawnManager;
        if (!sm?.softBulletGroup || !this.player) return;
        this.ensureFireballAnim();
        const dir = Math.sign(this.player.x - this.x) || 1;
        const sweep = new Bullet(this.scene, this.x, this.groundTop - 24, 'fireballsheet');
        sm.softBulletGroup.add(sweep);
        sweep.play('fireball');
        sweep.body.velocity.set(dir * 380 * this.shotSpeedMult, 0);
        this.trackShot(sweep);
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
        // showBossBar is nearest-wins and reports whether this boss owns
        // the bar now; retry while close so a boss that lost the bar to
        // a nearer one retakes it when that fight ends or moves away.
        if (close && (!this.barVisible || ui._boss !== this)) {
            this.barVisible = ui.showBossBar(this, 'THE BOMBARDIER');
        } else if (!close && this.barVisible) {
            ui.hideBossBar(this);
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
        this.scene.player?.playerUI?.hideBossBar(this);
        this.barVisible = false;
        this.gen++; // invalidate any in-flight telegraphs
        this.dead = true;
        player.updateMoney(reward);
        this.dropFirstKillLoot();
        // Rematch: leaving the arena and coming back re-spawns the boss in
        // hard mode (see armRematchTrigger). First-kill loot is flag-guarded,
        // so a rematch can never pay it twice.
        this.armRematchTrigger(this.homeX, this.homeY,
            () => this.scene.spawnManager?.spawnMiniboss(this.homeX, this.homeY));
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
        this.scene?.player?.playerUI?.hideBossBar(this);
        super.deactivate();
    }
}
