import GameManager from "./GameManager.js";

export default class BaseEnemy extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, id = 'duck', health = 1) {
        super(scene, x, y, id);

        scene.add.existing(this);

        this.player = scene.player;

        this.doesReplicate = false;
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

    TakeDamage(x, y, damage = 1, stunDuration = 300) {
        if (this.dead || !this.canDamage) return false;
        if (!this.createdHealthBar) this.createHealthBar();

        const ok = this.applyDamage(x, y, damage, stunDuration);

        // Shard-shop Lifesteal line: landing a hit on a boss feeds a
        // little health back (+1 HP per hit per level). Bosses only
        // (name 'boss'/'boss2') — regular enemies don't trigger it.
        if (ok) {
            const lvl = GameManager.upgrades?.shardShop?.lifesteal ?? 0;
            if (lvl > 0 && (this.name === 'boss' || this.name === 'boss2')) {
                this.player?.adjustHealth?.(lvl);
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

    replicateEnemy() {
        if (!this.doesReplicate) return;

        if (this.replicateTimer < this.scene.time.now) {
            this.replicateTimer = this.scene.time.now + 100;
        }

        if (this.scene && !this.isRemote && this.scene.network) {
            this.scene.network.socket.emit('enemyStateRequest', {
                id: this.id,
                type: this.name,
                x: this.x,
                y: this.y,
                vx: this.body.velocity.x,
                vy: this.body.velocity.y,
                sceneKey: this.scene.scene.key,
            });
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
    // and removes itself once fired.
    armRematchTrigger(x, y, spawnFn) {
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