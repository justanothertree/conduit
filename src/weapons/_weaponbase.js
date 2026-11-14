import GameManager from "../things/GameManager.js";
import { playHitSound, playSound } from "../things/soundUtils.js";

export default class WeaponBase {
    constructor(scene, player, baseDamage = 1) {
        this.scene = scene;
        this.player = player;
        this.scene.events.once('shutdown', this.destroy, this);
        this.scene.events.once('destroy', this.destroy, this);

        this.hitTargets = [];
        this.cooldown = false;
        this.cooldownDelay = 0;
        this.meleeRayTick = false;
        this.rayTickData;
        this.offset;
        this.throwSoundId = 'shurikanthrow';
        this.hitSoundId = 'shurikanhit';
        this.baseDamage = baseDamage;
        this.baseCooldown = 200;
        this.spamAdd = 50;
        this.knockStrength = 800;
        this.meleeDuration = this.cooldownDelay;
        this.hitLocation;
        this.tickHit = false;
        this.cooldownTimer = 0;
        this.headOffset = 10;

        // Scratch objects reused by the per-frame melee ray path
        // (fireRayAttack / polygonRay) so a sword/whip swing allocates
        // nothing per frame: ray AABB, per-target bounds, hit rect.
        this._rayRect = new Phaser.Geom.Rectangle();
        this._targetBounds = new Phaser.Geom.Rectangle();
        this._hitRect = new Phaser.Geom.Rectangle();

    }

    damage() {
        return this.baseDamage * this.damageScaling() * this.shardDamageMult();
    }

    // Shard-shop Damage line: +10% weapon damage per purchased level.
    // Read live from the save so it applies without re-equipping.
    shardDamageMult() {
        const lvl = GameManager.upgrades?.shardShop?.damage ?? 0;
        return 1 + 0.10 * lvl;
    }

    // Shard-shop Cooldown line: -10% weapon cooldown per purchased level
    // (up to -30%). Read live from the save so it applies without
    // re-equipping.
    shardCooldownMult() {
        const lvl = GameManager.upgrades?.shardShop?.cooldown ?? 0;
        return 1 - 0.10 * lvl;
    }

    // Shard-shop Multishot line: +1 shurikan per throw per purchased
    // level (up to +3). Read live from the save; WeaponShurikan
    // fires the extras at a slight spread.
    shardMultishot() {
        return GameManager.upgrades?.shardShop?.multishot ?? 0;
    }

    // Shard-shop Pierce line: shurikans pass through +1 enemy per
    // purchased level (up to +3) instead of stopping at the first.
    // Read live from the save; ShurikanProjectile counts pierced hits
    // per projectile.
    shardPierce() {
        return GameManager.upgrades?.shardShop?.pierce ?? 0;
    }

    damageScaling() {
        const money = GameManager.power.money;
        if (!money) return 1;
        if (money < 100000) {
            return 1 + money / 100000;
        } else {
            return 2 + money / 500000;
        }
    }

    update(delta) {
        if (!this.cooldown)
            this.cooldownDelay = Math.max(this.baseCooldown, this.cooldownDelay -= delta * .65);
        else {
            const elapsed = this.scene.time.now - this.cooldownStartTime;
            this.cdProgress = Phaser.Math.Clamp(elapsed / this.cd, 0, 1);
        }

        if (this.meleeRayTick) {
            this.rayTickData.start.x = this.player.x;
            this.rayTickData.start.y = this.player.y - 10;
            this.fireRayAttack(this.rayTickData);
        }
    }

    setStats() { }

    canFire() {
        return !this.cooldown;
    }

    startCooldown() {
        this.cooldown = true;
        this.cd = Math.max(this.baseCooldown, this.baseCooldown + this.cooldownDelay)
            * this.shardCooldownMult();

        this.cooldownStartTime = this.scene.time.now;

        this.cooldownTimer = this.scene.time.delayedCall(this.cd, () => {
            this.cooldown = false;
        });

        this.cooldownDelay += this.spamAdd;
    }

    destroy() {
        this.scene.events.off('update', this.update, this);
        // any other cleanup here
    }

    onBlur() { }

    calculateShot(pointer, scale = 1, rayThickness = 26) {
        // Plain {x, y} objects, not Vector2s: the old version allocated
        // ~8 Vector2s per shot (start/end/cursorPos/direction/vector plus
        // the intermediates), and every consumer only ever reads .x/.y —
        // the melee ray path even stores the result in rayTickData and
        // reads it across frames, so the retained object was a Vector2
        // too. The shurikan socket emit serializes to the same
        // {"x","y"} JSON either way. The zero-length guard matches
        // Phaser's Vector2.normalize, which leaves (0, 0) untouched.
        const x = this.player.x;
        const y = this.player.y - this.headOffset;
        const cursorPos = pointer.positionToCamera(this.scene.cameras.main);
        const dx = cursorPos.x - x;
        const dy = cursorPos.y - y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const inv = len > 0 ? 1 / len : 0;
        const dirX = dx * inv;
        const dirY = dy * inv;
        const vecX = dirX * scale;
        const vecY = dirY * scale;

        return {
            start: { x, y },
            end: { x: x + vecX, y: y + vecY },
            cursorPos: { x: cursorPos.x, y: cursorPos.y },
            direction: { x: dirX, y: dirY },
            distance: scale,
            vector: { x: vecX, y: vecY },
            rayThickness: rayThickness,
        };
    }

    fire(pointer) { }

    release(pointer) { }

    fireRayAttack(data) {
        const groups = this.scene.attackableGroups;
        const RectRay = this.polygonRay(data, data.rayThickness);

        // Reuse a single graphics object (was leaking one per frame).
        if (!this.scene.graphics) {
            this.scene.graphics = this.scene.add.graphics();
        }
        // this.scene.graphics.clear();
        // this.scene.graphics.lineStyle(2, 0xff0000);

        // this.scene.graphics.lineStyle(1, 0x00ff00);

        groups.forEach(({ group, handler }) => {
            group.getChildren().forEach(target => {
                if (group.name === 'pvpGroup') return;
                if (target.dead) return;

                // find end of weapon to target box, with plain math —
                // no Vector2 allocations per target per frame.
                const bounds = target.getBounds(this._targetBounds);
                const cx = Phaser.Math.Clamp(data.start.x, bounds.left, bounds.right);
                const cy = Phaser.Math.Clamp(data.start.y, bounds.top, bounds.bottom);
                const dx = cx - data.start.x;
                const dy = cy - data.start.y;
                const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

                // skip far targets
                if (distanceToTarget > data.distance + 200) return;

                // line trace
                if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, RectRay)) {
                    const hitRec = Phaser.Geom.Rectangle.Intersection(bounds, RectRay, this._hitRect);
                    const hit = { x: hitRec.centerX, y: hitRec.centerY };
                    this[handler]?.(target, true, hit);
                }
            });
        });
    }

    polygonRay(data, thickness) {
        const endX = this.rayTrackEnd
            ? data.end.x
            : data.start.x + data.vector.x;
        const endY = this.rayTrackEnd
            ? data.end.y
            : data.start.y + data.vector.y;

        // Perpendicular to the (unit) direction, half the ray thickness.
        const px = -data.direction.y * thickness / 2;
        const py = data.direction.x * thickness / 2;

        // AABB of the four ray corners (start/end ± perp), inflated by 1
        // — the same box the old Polygon + GetAABB + Inflate produced,
        // computed with plain numbers into the reused scratch rect.
        const minX = Math.min(data.start.x - px, data.start.x + px, endX - px, endX + px);
        const maxX = Math.max(data.start.x - px, data.start.x + px, endX - px, endX + px);
        const minY = Math.min(data.start.y - py, data.start.y + py, endY - py, endY + py);
        const maxY = Math.max(data.start.y - py, data.start.y + py, endY - py, endY + py);
        const rayRect = this._rayRect;
        rayRect.x = minX - 1;
        rayRect.y = minY - 1;
        rayRect.width = maxX - minX + 2;
        rayRect.height = maxY - minY + 2;

        // Debug draw (was: stroke the ray polygon points)
        // const graphics = this.scene.add.graphics();
        // graphics.lineStyle(1, 0xffff00);

        return rayRect;
    }

    platformHit(plat) {
    }

    // allowLifesteal=false for hits that must never heal (aura ticks —
    // see WeaponAuraZap's override). Direct weapon hits pass the default.
    enemyHit(target, stunDuration = 300, hit, allowLifesteal = true) {
        if (!this.canHit(target)) return;

        // Compute the knockback once: the old code called getKnockBack twice
        // for the same hit.
        const knockback = this.getKnockBack(target);
        if (target.TakeDamage(knockback.x, knockback.y, this.damage(), stunDuration, allowLifesteal)) {
            playHitSound(this.scene, this.hitSoundId);
            //this.scene.add.particles()
        }
    }

    itemHit(target) {
        if (!this.canHit(target)) return;

        target.hit?.(this.player, this.baseDamage, this.getKnockBack(target));
    }

    bulletHit(target) {
        if (!this.canHit(target)) return;

        target.hit?.(this, target);
        playHitSound(this.scene, this.hitSoundId);
        target.destroy(this.scene, this.hitSoundId);
    }

    canHit(target) {
        if (this.hitTargets.find(t => t === target)) return false;

        this.hitTargets.push(target);
        return true;
    }

    clearHits() {
        this.hitTargets = [];
    }

    getKnockBack(target, direction) {
        // Plain scalar math — no Vector2 allocation per hit. Same values as
        // the old normalize-then-scale: a zero-length direction stays (0, 0),
        // matching Phaser's Vector2.normalize guard. Returns a plain {x, y}:
        // both consumers only read .x/.y (enemyHit passes them to TakeDamage;
        // itemHit passes it to target.hit, whose only Vector2-using
        // implementation is Pickup.hit — now scalar too).
        if (direction) {
            return { x: direction.x * this.knockStrength, y: direction.y * this.knockStrength };
        }
        const dx = target.x - this.player.x;
        const dy = target.y - this.player.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const inv = len > 0 ? 1 / len : 0;
        return { x: dx * inv * this.knockStrength, y: dy * inv * this.knockStrength };
    }

    playThrowSound() {
        playSound(this.scene, this.throwSoundId);
    }

    mapRangeClamped(value, inMin, inMax, outMin, outMax) {
        if (inMin === inMax) return outMin; // Avoid divide by zero

        // Normalize input range to 0–1
        let t = (value - inMin) / (inMax - inMin);

        // Clamp the normalized value
        t = Math.max(0, Math.min(1, t));

        // Remap to output range
        return outMin + (outMax - outMin) * t;
    }

}

