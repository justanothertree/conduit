import { playHitSound } from "../things/soundUtils.js";
import WeaponProjectile from "./_baseWeaponProjectile.js";

export default class DarkOrbProjectile extends WeaponProjectile {
    constructor(scene, x, y, player, weapon, pointer) {
        super(scene, x, y, 'darkorb', player, weapon)
        this.destroyOnHit = false;

        this.pointer = pointer;

        // Scratch vector reused by preUpdate's per-frame steering — the old
        // code allocated a fresh Vector2 (plus the one positionToCamera
        // creates) every frame while the orb flies. Same churn class as
        // BaseEnemy.currentSpeed / LaserSprite.boxTrace.
        this._cursorPos = new Phaser.Math.Vector2();

        this.name = 'orb'


        if (!scene.anims.get('darkorb')) {
            scene.anims.create({
                key: 'darkorb',
                frames: scene.anims.generateFrameNumbers('darkorb', { start: 0, end: 3 }),
                frameRate: 10,
                repeat: -1,
            })
        }
        // Spin tween
        this.spinTween = this.scene.tweens.add({
            targets: this,
            angle: 360,
            duration: 2000,
            repeat: -1,
            ease: 'Linear',
        });

        this.play('darkorb');

        this.activate();
    }

    activate(x, y) {
        if (x || y) {
            this.setPosition(x, y);
        }

        this.setActive(true);
        this.setVisible(true);
        this.body.enable = true;

        this.damageTick = this.scene.time.addEvent({
            delay: 80,
            callback: () => {
                this.hitTargets = [];
            },
            repeat: -1,
        });

    }

    deactivate() {
        this.scene.time.removeEvent(this.damageTick);
        this.setActive(false);
        this.setVisible(false);
        this.body.enable = false;
        this.hitTargets = [];
        this.detonated = false;
        this.detonateTime = null;
    }

    // Aura-spawned orbs (no owning weapon — AuraZap constructs them with
    // weapon undefined) are aura damage and never trigger Lifesteal. An
    // equipped dark orb is a direct weapon hit and heals normally.
    enemyHit(enemy, stunDuration = 300) {
        if (!this.canHit(enemy)) return;

        // Scalar read of the body velocity — no per-hit Vector2 allocation
        // (same pattern as Pickup.hit). TakeDamage only reads the numbers.
        const vx = this.body.velocity.x * .2;
        const vy = this.body.velocity.y * .2;

        if (enemy.TakeDamage(vx, vy, this.damage(), stunDuration, !!this.weapon)) {
            playHitSound(this.scene, this.hitSoundId);
        }
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        this.setScale(this.scale + .002);
        if (this.detonate) {
            this.setVelocity(0, 0);
            this.setScale(this.scale + 0.005);

            // Initialize if not set, then check time
            const detonateTime = (this.detonateTime ??= time + 500);

            if (time > detonateTime) {
                this.deactivate();
            }
        } else {
            // Steer toward the pointer with plain scalar math — identical
            // result to normalizing a fresh Vector2 and scaling by 200.
            // (Vector2.normalize leaves a zero vector as (0, 0); the `|| 1`
            // guard matches that: dx/len and dy/len are both 0.)
            const cursorPos = this.pointer.positionToCamera(this.scene.cameras.main, this._cursorPos);
            const dx = cursorPos.x - this.x;
            const dy = cursorPos.y - this.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            this.setVelocity(dx / len * 200, dy / len * 200);
        }
    }
}