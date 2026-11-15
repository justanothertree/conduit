import GameManager from "./GameManager.js";

export default class BaseEnemy extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, id = 'duck', health = 1) {
        super(scene, x, y, id);

        scene.add.existing(this);

        this.player = scene.player;

        // Part 2 — host-authoritative enemies. isRemote: this enemy is
        // a puppet driven by the host's state broadcasts (no AI, no
        // local damage, no projectile spawning). netId is the stable
        // spawn-point identity assigned by SpawnManager on every
        // spawn/activation; netType is the canonical lowercase type
        // string used on the wire (this.name keeps its legacy mixed
        // case — 'sunMan' — and is never sent).
        this.isRemote = false;
        this.netId = null;
        this.netType = null;
        this.maxHealth = health;
        this.health = health;
        this.canDamage = true;
        this.createdHealthBar = false;
        this.alive = true;
        this.hitRecover = undefined;
        this.velocityKnock = false;
        this.knockPower = 500;
        this.damage = 1;
        this.maxaccell = 300;
        this.staggerDR = 1.0;


        // Behavior config
        this.speed = 150;
        this.jumpPower = 550;
        this.stuckJumpCooldown = 1000; // ms cooldown between stuck jumps
        this.edgeLookaheadDistance = 10; // pixels to check for platform edges
        this.direction = 1; // -1 = left, 1 = right
        this.patrolDelay = 2000; // ms delay before turn after overrun
        this.lastTurnTime = 0;
        this.onPlatform = false;
        this.recentlyDamaged = false;
        this.jumpDelay = 4000;
        // Internal state
        this.state = 'idle';  // 'idle', 'walking', 'jumping', 'falling'
        this.hasJumpedFromStuck = false;
        this.lastJumpTime = 0;
        this.prevPos = new Phaser.Math.Vector2(x, y);
        this.targetPos = new Phaser.Math.Vector2(x, y);
        this.lerpDuration = 33;
        // Scratch vectors for currentSpeed(): it runs on every scene update
        // for every enemy, so allocating two fresh Vector2s per call per
        // enemy was steady per-frame GC churn (notable on phones). The
        // values produced are identical — only the object identity changes,
        // and nothing outside this method holds the old objects except
        // movementDirection, which locoAnims reads as plain x/y.
        this._speedCur = new Phaser.Math.Vector2(x, y);
        this._speedDelta = new Phaser.Math.Vector2();

        this.scene.events.on('update', this.currentSpeed, this)

    }

    init() { }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead) return;
        this.updateHealthBar();
        this.locoAnims();
        if (!this.stunned) this.staggerDR = Phaser.Math.Clamp(this.staggerDR + delta / 10000, 0, 1);
        // Remote puppet: the host owns the position — interpolate
        // toward its last broadcast target and run no AI at all (the
        // accelToPlayer line below, and every subclass's patrol/chase/
        // attack code after this super call, must not run). Subclasses
        // return early right after super.preUpdate too, so a puppet
        // never telegraphs, shoots, or locks an arena.
        if (this.isRemote) {
            this.lerpPosition(delta);
            return;
        }
        if (this.accelToPlayerSpeed) this.scene.physics.accelerateToObject(this, this.player, this.accelToPlayerSpeed, this.maxaccell, this.maxaccell);


    }

    createHealthBar() {
        this.createdHealthBar = true;
        this.healthBarWidth = Phaser.Math.Clamp(this.maxHealth * 8, 16, 128);
        this.healthBar = this.scene.add.rectangle(this.x, this.y - this.displayHeight / 2 - 6, this.healthBarWidth, 6, 0xff0000, 1);
        this.healthBar.setOrigin(0.5);
    }

    updateHealthBar() {
        if (!this.healthBar) return;

        const percent = Phaser.Math.Clamp(this.health / this.maxHealth, 0, 1);
        this.healthBar.setScale(percent, 1);

        // Positioning
        this.healthBar.x = this.x;
        this.healthBar.y = this.y - this.displayHeight / 2 - 6;
    }

    // allowLifesteal=false for hits that must never heal: chain-shurikan
    // jumps and aura ticks (WeaponAuraZap / aura-spawned dark orbs). Only
    // direct weapon hits feed Lifesteal.
    TakeDamage(x, y, damage = 1, stunDuration = 300, allowLifesteal = true) {
        if (this.dead || !this.canDamage) return false;
        // Remote puppet (Part 2): never apply damage locally — route
        // the hit to the host and flash for responsiveness. The HP
        // change rides the host's next state broadcast. Returns true
        // so the weapon still plays its hit sound and chains like a
        // real hit. (Charger checks its frontal shield before reaching
        // here, so a blocked hit never even routes.)
        if (this.isRemote) {
            this.routeHitToHost(x, y, damage, stunDuration);
            return true;
        }
        if (!this.createdHealthBar) this.createHealthBar();

        const ok = this.applyDamage(x, y, damage, stunDuration);

        // Shard-shop Lifesteal line: landing a direct hit on a boss feeds
        // a little health back (+1 HP per hit per level). Bosses only
        // (name 'boss'/'boss2'/'miniboss') — regular enemies don't
        // trigger it. Capped at one heal per 250ms: without the cap,
        // Multishot + chain + aura ticks healed ~12 HP per throw and
        // bosses became unlosable, and every heal also fired an
        // updateHealth socket message. The throttle lives on the player
        // (one heal stream per player, not per enemy).
        if (ok && allowLifesteal) {
            const lvl = GameManager.upgrades?.shardShop?.lifesteal ?? 0;
            if (lvl > 0 && (this.name === 'boss' || this.name === 'boss2' || this.name === 'miniboss')) {
                const player = this.player;
                const now = this.scene?.time?.now ?? 0;
                if (player && now - (player._lifestealLastHeal ?? -1e9) >= 250) {
                    player._lifestealLastHeal = now;
                    player.adjustHealth?.(lvl);
                }
            }
        }

        return ok;

    }

    applyDamage(x, y, damage = 1, stunDuration = 300) {
        this.health -= damage;
        this.updateHealthBar();

        if (this.health <= 0) {
            this.alive = false;
            if (!this.scene) return;
            this.scene?.time?.removeEvent(this.hitRecover);
            this.die(this.player);
        } else {

            if ((stunDuration > 0) && (this.staggerDR > .33)) {
                this.staggerDR /= 1.5;
                this.stunned = true;
                if (!this.prevVelocity) {
                    this.prevVelocity = this.body.velocity.clone();
                }
                this.setVelocity(x / 3, y / 3)
                this.setTint(0xff0000);
                this.scene?.time?.removeEvent(this.hitRecover);
                this.hitRecover = this.scene?.time?.addEvent({
                    delay: stunDuration * this.staggerDR,
                    callback: () => {
                        if (!this.dead) {
                            this.stunned = false;
                            this.setVelocity(this.prevVelocity.x, this.prevVelocity.y);
                            delete this.prevVelocity
                            this.restoreTint();
                        }
                    }
                });
            } else {
                this.setTint(0xff0000);
                this.scene?.time.delayedCall(100, () => {
                    this.restoreTint();
                })
            }

            this.recentlyDamaged = true;
            if (this.recentlyDamagedTimer) this.scene?.time.removeEvent(this.recentlyDamagedTimer)
            this.recentlyDamagedTimer = this.scene.time.delayedCall(5000, () => {
                this.recentlyDamaged = false;
            })

        }

        return true;

    }

    die(player) {
        this.dead = true;
        player.updateMoney(this.maxHealth);
        this.emit('die', player);

        this.deactivate();

    }

    // Route a hit on a remote puppet to the host (Part 2): the host
    // validates and applies it, and the result rides the next state
    // broadcast. Local feedback is a red hit flash only — no HP
    // change, no knockback, no stun, no Lifesteal: the host owns all
    // of that. Damage is capped client-side as well as host-side.
    // No throttle: every path that reaches here is already discrete
    // per hit (melee rays guard with hitTargets, projectiles with
    // canHit, aura zaps fire on a timer), so a routed hit is one
    // small volatile packet.
    routeHitToHost(x, y, damage, stunDuration) {
        if (!this.createdHealthBar) this.createHealthBar();
        this.setTint(0xff0000);
        this.scene?.time?.delayedCall(100, () => {
            if (!this.dead) this.restoreTint();
        });
        if (!this.netId || !Number.isFinite(damage) || damage <= 0) return;
        this.scene?.network?.socket?.volatile.emit('enemyHitRequest', {
            netId: this.netId,
            damage: Math.min(damage, 50),
            kx: Number.isFinite(x) ? x : 0,
            ky: Number.isFinite(y) ? y : 0,
            stun: Number.isFinite(stunDuration) ? stunDuration : 300,
        });
    }

    // One enemy projectile, shared by every shooter (Part 2): the host
    // also emits the shot so non-hosts can spawn the same fireball
    // locally (real Bullet, can hurt the local player). Call AFTER the
    // bullet exists with its velocity set. Puppets never shoot, and
    // only the host emits — a client that just lost host status stops
    // mid-volley rather than double-firing with the new host.
    emitEnemyShot(bullet) {
        const net = this.scene?.network;
        if (!net || !net.socket || this.isRemote || !net.isHost()) return;
        // Active check: the mini-boss's trackShot() destroys the bullet
        // when its 36-shot cap is hit, and emit runs after it — a
        // destroyed bullet must never be emitted (its velocity is gone
        // and the receiver would spawn a shot the host doesn't have).
        if (!bullet?.active || !bullet?.body) return;
        net.socket.volatile.emit('enemyShotRequest', {
            kind: 'fireball',
            start: { x: Math.round(bullet.x), y: Math.round(bullet.y) },
            velocity: {
                x: Math.round(bullet.body.velocity.x),
                y: Math.round(bullet.body.velocity.y),
            },
        });
    }

    // Boss phase from HP fraction, without side effects (Part 2):
    // puppets need the phase tint + bar phase to track the host's HP,
    // but updatePhase() fires volleys and phase bursts — never call
    // that on a puppet. Default thresholds are the big bosses'
    // (0.66/0.33); the Bombardier calls syncRemotePhase(0.5, -1) for
    // its two phases.
    syncRemotePhase(mid = 0.66, low = 0.33) {
        if (this.phase === undefined) return;
        const frac = this.maxHealth ? this.health / this.maxHealth : 1;
        const ph = frac > mid ? 1 : frac > low ? 2 : 3;
        if (ph !== this.phase) {
            this.phase = ph;
            this.restoreTint();
        }
    }

    // Flip an enemy between AI-driven and puppet (Part 2). Going
    // remote stops everything that moves or shoots it: the homing
    // timer is removed, gravity is parked (the lerp owns the
    // position — a falling puppet would fight it), pending telegraph
    // generations are invalidated so a delayed volley can't fire,
    // and the lerp stretches to the ~83ms broadcast cadence. Waking
    // up restores gravity and re-arms the AI timers from a beat out
    // (patrol timers reset is acceptable — the position and HP carry
    // over, which is what matters), and re-starts homing for bats
    // and sunmen from their stored accel range.
    setRemote(remote) {
        if (this.isRemote === remote) return;
        this.isRemote = remote;
        const now = this.scene?.time?.now ?? 0;
        if (remote) {
            this._gravWas = this.body ? this.body.allowGravity : true;
            if (this.body) {
                this.body.allowGravity = false;
                this.body.setVelocity(0, 0);
            }
            this.accelToPlayerSpeed = 0;
            if (this.accelToPlayerTimer) {
                this.scene?.time?.removeEvent(this.accelToPlayerTimer);
                this.accelToPlayerTimer = null;
            }
            this.lerpDuration = 90;
            this.windingUp = false;
            if (this.volleyGen !== undefined) this.volleyGen++;
            if (this.gen !== undefined) this.gen++;
            this.lerpTimer = 0;
            this.prevPos.set(this.x, this.y);
            this.targetPos.set(this.x, this.y);
        } else {
            if (this.body && this._gravWas !== undefined) {
                this.body.allowGravity = this._gravWas;
            }
            this.lerpDuration = 33;
            if (this.nextShot !== undefined) this.nextShot = now + 1500;
            if (this.nextDrop !== undefined) this.nextDrop = now + 1500;
            if (this.nextAttack !== undefined) this.nextAttack = now + 3000;
            if (this.nextFireball !== undefined) this.nextFireball = now + 1500;
            if (this.nextCharge !== undefined) this.nextCharge = now + 1500;
            this.windingUp = false;
            if (this._accelMin !== undefined) this.accelToPlayer();
        }
    }

    lerpPosition(delta) {
        if (this.dead) return;

        this.lerpTimer += delta;

        const t = Phaser.Math.Clamp(this.lerpTimer / this.lerpDuration, 0, 1);
        const lerpedX = Phaser.Math.Linear(this.prevPos.x, this.targetPos.x, t);
        const lerpedY = Phaser.Math.Linear(this.prevPos.y, this.targetPos.y, t);

        this.x = lerpedX;
        this.y = lerpedY;
    }

    setLerpPosition(x, y) {
        if (x === 0 || y === 0) return;
        this.lerpTimer = 0;
        this.prevPos.set(this.x, this.y);
        this.targetPos.set(x, y);
        // The lerp owns the position now — a physics velocity would
        // fight it (and gravity is off for puppets), so stop the body.
        if (this.body) this.body.setVelocity(0, 0);
    }

    deactivate() {
        // Detach the update listener (registered in constructor) to avoid leaks.
        this.scene?.events.off('update', this.currentSpeed, this);
        if (this.healthBar) {
            this.healthBar.destroy();
            this.healthBar = null;
        }
        if (this.healthBarBg) {
            this.healthBarBg.destroy();
            this.healthBarBg = null;
        }
        this.createdHealthBar = false;
        // A dying boss always unseals its arena — the lock must never
        // outlive the fight (see lockBossArena).
        this.unlockBossArena();
        this.setActive(false);
        this.setVisible(false);
        this.body.stop();
        this.body.enable = false;
        this.dead = true;
    }

    activate(x, y, health = 1) {
        this.setActive(true);
        this.setVisible(true);
        this.setPosition(x, y);
        this.setTint();
        this.body.enable = true;

        this.dead = false;
        this.stunned = false;
        this.isPooled = false;
        this.health = health;
        this.maxHealth = health;
        // A re-activated enemy starts a fresh network life: no stale
        // death broadcast, no stale rematch arming, and no lerp from
        // wherever the previous life ended.
        this._netDeathSent = false;
        this._rematchArmed = false;
        this.lerpTimer = 0;
        this.prevPos.set(x, y);
        this.targetPos.set(x, y);

        // Re-register the update listener (removed in deactivate()).
        this.scene.events.off('update', this.currentSpeed, this);
        this.scene.events.on('update', this.currentSpeed, this);

        return true;
    }

    playerCollide(player) {
        const direction = new Phaser.Math.Vector2(player.x - this.x, player.y - this.y);
        const knockback = direction.normalize().scale(this.knockPower);

        player.TakeDamage(knockback.x, knockback.y, this.damage);
    }

    scaleCollision(x, y) {
        this.body.setSize(x, y); // Smaller than sprite size
        this.body.setOffset(
            (this.width - x) / 2,
            (this.height - y) / 2
        );
    }

    // Hook: clear the hit-flash tint. Subclasses with a persistent tint
    // (e.g. Boss phase colors) override this to restore it instead.
    restoreTint() {
        this.setTint();
    }

    currentSpeed(time, delta) {
        // Reuse the scratch vectors (see constructor): same math as before,
        // no per-frame allocation.
        const currentPos = this._speedCur.set(this.x, this.y);
        const deltaPos = this._speedDelta.copy(currentPos).subtract(this.prevPos);
        const dist = deltaPos.length();

        // Only update realSpeed if it actually moved
        if (dist > 0.01) {
            this.realSpeed = dist / (delta / 1000); // pixels per second
            this.prevPos.copy(currentPos);
            this.movementDirection = deltaPos;
        }
    }

    patrol(time) {
        if (this.stunned) return;
        const onGround = this.body.blocked.down || this.body.touching.down;
        if (!onGround) return;

        // Check tile ahead and below to avoid ledge
        const aheadX = this.x + this.direction * 44;
        const tile = this.scene.walls?.getTileAtWorldXY(aheadX, this.y + 64);
        const wallTile = this.scene.walls?.getTileAtWorldXY(aheadX, this.y + 32);

        if (!tile || tile.index === -1 || wallTile || this.body.blocked.left || this.body.blocked.right || this.body.touching.left || this.body.touching.right) {
            if ((time > this.lastJumpTime + this.jumpDelay) && this.seesPlayer && (this.body.blocked.down || this.body.touching.down)) {

                this.setVelocityY(-500)
                this.lastJumpTime = time;
            }
            else if (time > this.lastTurnTime + this.patrolDelay) {
                this.direction *= -1;
                this.lastTurnTime = time;
            }
        }

        this.setVelocityX(this.direction * this.speed);
        this.flipX = this.direction > 0;
    }

    chasePlayer(time) {
        if (this.stunned) return;
        const dx = this.player.x - this.x;
        const dy = this.player.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 450 && Math.abs(dy) < 80 || this.recentlyDamaged) {
            // Player is close and roughly same height
            this.seesPlayer = true;
            this.speed = 200;
            if (this.direction !== Math.sign(dx) && !this.justTurned) {
                this.justTurned = true;
                this.direction = Math.sign(dx);
                this.scene.time.delayedCall(Phaser.Math.Between(500, 1500), () => this.justTurned = false);
            }

        } else {
            this.speed = 60;
            this.seesPlayer = false;
        }
    }

    locoAnims() {
        if (!this.movementDirection) return;
        if (this.movementDirection.x > 0) {
            this.flipX = true;
        } else {
            this.flipX = false;
        }
    }

    accelToPlayer(min, max) {
        // The 1s timer below re-rolls the chase speed, but it calls this
        // method with no arguments — so the range has to be remembered here.
        // Before this, Between(undefined, undefined) was NaN after the first
        // timer fire, and preUpdate's `if (this.accelToPlayerSpeed)` gate
        // went falsy: bats and sunmen stopped homing ~1s after spawning.
        if (min !== undefined) {
            this._accelMin = min;
            this._accelMax = max;
        }
        if (!this.accelToPlayerTimer) {
            this.accelToPlayerTimer = this.scene.time.addEvent({
                delay: 1000,
                loop: true,
                callback: () => this.accelToPlayer()
            })
        }
        this.accelToPlayerSpeed = Phaser.Math.Between(this._accelMin, this._accelMax);
    }

    distanceToPlayer() {
        const player = this.scene.player ? this.scene.player : null;
        if (!player) return;

        const dx = player.x - this.x;
        const dy = player.y - this.y;

        return Math.sqrt(dx * dx + dy * dy); // Euclidean distance
    }

    // Boss rematch trigger: after a boss dies, watch for the player
    // leaving the arena (>900px away) and coming back (<600px), then
    // re-spawn the boss in hard mode via spawnFn. A 10s grace after
    // death keeps the trigger from firing while the player is still
    // collecting first-kill loot. The check lives on the scene clock,
    // so it dies with the scene on level exit — no cross-scene leaks —
    // and removes itself once fired. _rematchArmed (reset in
    // activate()) keeps a death + a host handoff from arming it twice.
    armRematchTrigger(x, y, spawnFn) {
        if (this._rematchArmed) return;
        this._rematchArmed = true;
        const scene = this.scene;
        if (!scene) return;
        const readyAt = scene.time.now + 10000;
        let armed = false;
        const check = scene.time.addEvent({
            delay: 500,
            loop: true,
            callback: () => {
                const p = scene.player;
                if (!p) return;
                const dx = p.x - x, dy = p.y - y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (!armed) {
                    if (d > 900 && scene.time.now >= readyAt) armed = true;
                    return;
                }
                if (d < 600) {
                    scene.time.removeEvent(check);
                    spawnFn();
                }
            },
        });
        scene.events.once('shutdown', () => scene.time.removeEvent(check));
    }

    // ---- Boss intro (shared by the three bosses) ----
    // A quick name card + an optional arena lock, so a boss fight feels
    // like an event instead of another enemy walking in. The card is
    // NON-blocking: it never freezes input or plays a cutscene — the
    // player can move and attack through it, so a phone player is
    // fighting within ~2s of it appearing. The lock (if any) is a set of
    // invisible static barriers over the arena's exits while the fight is
    // live; die()/deactivate() always remove them, so a lock can never
    // outlive its boss.
    //
    // tryBossIntro is called from a boss's preUpdate with the boss's own
    // trigger test (`inside`) — each boss knows its room; the helper only
    // owns the once-per-life gate and the card/lock themselves. Lock
    // rects are world-px {x, y, w, h}, derived by the caller from its
    // arena bounds so they track the tilemap.

    // Once per life: show the card and seal the exits. No-ops until the
    // player is inside the fight.
    tryBossIntro(name, subtitle, inside, lockRects = []) {
        if (this.introShown || this.dead || !this.active || !inside) return;
        this.introShown = true;
        this.showBossNameCard(name, subtitle);
        if (lockRects.length) this.lockBossArena(lockRects);
    }

    showBossNameCard(name, subtitle) {
        const scene = this.scene;
        if (!scene) return;
        const cx = scene.scale.width / 2;
        const cy = scene.scale.height * 0.3;
        // 32px name fits a 360px phone viewport (longest name, 'FLOWLINE
        // GUARDIAN', is ~310px at this size); subtitle smaller.
        const nameText = scene.add.text(cx, cy, name, {
            fontSize: '32px',
            color: '#ffffff',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 8,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);
        const subText = scene.add.text(cx, cy + 44, subtitle, {
            fontSize: '18px',
            color: '#ffcc66',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 5,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);
        // Fade out after a beat. If the scene restarts mid-fade (player
        // death), the texts die with it — no leak, no stale card on the
        // next life.
        scene.tweens.add({
            targets: [nameText, subText],
            alpha: 0,
            delay: 1400,
            duration: 600,
            onComplete: () => { nameText.destroy(); subText.destroy(); },
        });
    }

    // Seal the arena exits with invisible static barriers (zones need no
    // texture). Only colliders with the player — bullets, the boss, and
    // pickups pass through untouched. Callers place the rects so the
    // player is never inside one when it appears (trigger a step inside
    // the room, barrier at the exit behind them).
    lockBossArena(rects) {
        const scene = this.scene;
        if (!scene || !scene.player || this._arenaLockZones) return;
        this._arenaLockZones = [];
        this._arenaLockColliders = [];
        for (const r of rects) {
            const zone = scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
            scene.physics.add.existing(zone, true); // static body
            const col = scene.physics.add.collider(scene.player, zone);
            this._arenaLockZones.push(zone);
            this._arenaLockColliders.push(col);
        }
    }

    unlockBossArena() {
        for (const c of this._arenaLockColliders ?? []) c?.destroy();
        for (const z of this._arenaLockZones ?? []) z?.destroy();
        this._arenaLockZones = null;
        this._arenaLockColliders = null;
    }

    // Nudge a loot drop point out of solid geometry. Probes the walls layer
    // (stone) and the walls2 layer (lava, fire damage) with the same
    // getTileAtWorldXY pattern used in snapToGround, walking the point up —
    // then sideways — until it sits in free air. Falls back to the
    // unnudged point: a pickup inside geometry is still better than no loot.
    // Shared by both bosses' first-kill loot (was Boss-only).
    nudgeDropPoint(x, y) {
        const walls = this.scene.walls;
        const lava = this.scene.walls2;
        if (!walls && !lava) return { x, y };
        const blocked = (px, py) => {
            if (walls) {
                const wt = walls.getTileAtWorldXY(px, py);
                if (wt && wt.index !== -1) return true;
            }
            if (lava) {
                const lt = lava.getTileAtWorldXY(px, py);
                if (lt && lt.index !== -1) return true;
            }
            return false;
        };
        if (!blocked(x, y)) return { x, y };
        // Walk upward in 32px steps — the drops are airborne pickups.
        let nx = x, ny = y;
        for (let i = 0; i < 12 && blocked(nx, ny); i++) ny -= 32;
        if (!blocked(nx, ny)) return { x: nx, y: ny };
        // Then sweep sideways at the original height.
        for (const dx of [64, -64, 128, -128, 192, -192]) {
            nx = x + dx;
            ny = y;
            if (!blocked(nx, ny)) return { x: nx, y: ny };
        }
        return { x, y };
    }
}