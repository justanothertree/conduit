import { playHitSound } from "../things/soundUtils.js";
import WeaponProjectile from "./_baseWeaponProjectile.js";

export default class ShurikanProjectile extends WeaponProjectile {
    constructor(scene, x, y, player, weapon, chainCount = 0, initialDamage = 1, maxTargets = 1, visualOnly = false) {
        super(scene, x, y, 'shurikan', player, weapon);

        this.baseDamage = initialDamage;
        this.maxTargets = maxTargets;
        this.chainCount = chainCount;
        this.destroyOnHit = false;
        this.visualOnly = visualOnly;
        this.shrinkCollision(this, this.width/1.6, this.height/1.6)

        
        this.setBounce(.8);
        this.allowGravity = false;
        this.setScale(.15);

        // Spin tween
        this.scene.tweens.add({
            targets: this,
            angle: 360,
            duration: 300,
            repeat: -1,
            ease: 'Linear',
        });

        // Cleanup
        scene.time.delayedCall(700, () => this.destroy());

    }

    enemyHit(enemy, stunDuration = 300) {
        if(this.visualOnly) return;
        if (!this.canHit(enemy)) return;

        // Scalar read of the body velocity — no per-hit Vector2 allocation
        // (same pattern as Pickup.hit). TakeDamage only reads the numbers.
        const vx = this.body.velocity.x * .1;
        const vy = this.body.velocity.y * .1;

        // Chain jumps never trigger Lifesteal (see BaseEnemy.TakeDamage):
        // only the direct throw heals, and the 250ms throttle caps it.
        if (enemy.TakeDamage(vx, vy, this.damage(), stunDuration, !this.isChain)) {
            playHitSound(this.scene, this.hitSoundId);
        }

        if (this.chainCount > 0) {
            this.chainAttack(enemy);
        }

        // Shard-shop Pierce line: pass through +N enemies per level
        // instead of stopping at the first. canHit() records each hit in
        // hitTargets, so the same enemy never re-triggers while we fly
        // through it, and the 700ms cleanup in the constructor still
        // destroys the shurikan.
        const pierce = this.weapon?.shardPierce?.() ?? 0;
        if ((this._pierced ?? 0) < pierce) {
            this._pierced = (this._pierced ?? 0) + 1;
            return; // keep flying
        }

        this.setVelocity(0)
        this.scene.time?.delayedCall(25, () =>{
            this.destroy();
        })
    }

    bulletHit(target) {
        if(this.visualOnly) return;
        super.bulletHit(target);

        if (this.chainCount > 0) {
            this.chainAttack(target);
            this.destroy();
        } else {
            this.destroy();
        }
    }

    itemHit(item) {
        if(this.visualOnly) return;
        super.itemHit(item);
    }

    touchWall() {
        this.customBounce();
    }

    platformHit() {
    }

    chainAttack(enemy) {
        const groups = this.scene.attackableGroups;
        const range = 400;
        const validTargets = [];

        groups.forEach(({ zap, group, handler }) => {
            if (!zap) return;

            group.getChildren().forEach(target => {
                if (target === enemy || target.dead) return;
                // Plain scalar distance — the old code built a Vector2 per
                // target in range just to measure and aim at it.
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance <= range) {
                    validTargets.push({
                        target,
                        distance,
                        handler,
                    });
                }
            });
        });

        // Sort by distance, ascending
        validTargets.sort((a, b) => a.distance - b.distance);

        // Hit up to this.maxTargets
        for (let i = 0; i < Math.min(validTargets.length, this.maxTargets); i++) {
            const { target } = validTargets[i];
            this.chainCount--;
            const chainShurikan = new ShurikanProjectile(this.scene, this.x, this.y, this.player, this.weapon, this.chainCount, 1, 1, false)
            // Chain jumps are not direct hits — they never trigger
            // Lifesteal (enemyHit passes !isChain to TakeDamage).
            chainShurikan.isChain = true;
            chainShurikan.hitTargets.push(enemy);
            this.scene.weaponGroup.add(chainShurikan);
            // Same normalize-then-scale(1000) as before, in plain math:
            // Vector2.normalize leaves a zero vector as (0, 0), matched
            // here by the `|| 1` guard.
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            chainShurikan.allowGravity = false;
            chainShurikan.setVelocity(dx / len * 1000, dy / len * 1000)
            chainShurikan.setScale(.11)

        }
    }

}
