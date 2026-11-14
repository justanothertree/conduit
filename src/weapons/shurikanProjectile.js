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

        const velocity = this.body.velocity.clone().scale(.1);

        if (enemy.TakeDamage(velocity.x, velocity.y, this.damage(), stunDuration)) {
            playHitSound(this.scene, this.hitSoundId);
        }

        if ((this.chainCount > 0)) {
            this.chainAttack(enemy);
            this.setVelocity(0)
            this.scene.time?.delayedCall(25, () =>{
            this.destroy();

            })
        } else {
            this.setVelocity(0)
            this.scene.time?.delayedCall(25, () =>{
            this.destroy();

            })
        }
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
