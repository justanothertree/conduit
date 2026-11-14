import { playSound } from "./soundUtils.js";

export default class Pickup extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, id = 'coin') {
        super(scene, x, y, id)
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.pickupSound = 'pickup';
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        const bounds = this.scene.physics.world.bounds;

        if (this.x > bounds.x + bounds.width) {
            this.x = bounds.x - this.width;
        }
        if (this.x + this.width < bounds.x) {
            this.x = bounds.x + bounds.width;
        }
        if (this.y > bounds.y + bounds.height) {
            this.y = bounds.y - this.height;
        }
        if (this.y + this.height < bounds.y) {
            this.y = bounds.y + bounds.height;
        }
    }


    playerCollide(player) { }

    playPickupSound() {
        playSound(this.scene, this.pickupSound);
    }

    hit(player, damage, velocity) {
        // Plain scalar math — velocity may be a Phaser Vector2 (projectile
        // hits) or the plain {x, y} getKnockBack now returns (melee hits);
        // either way only .x/.y are read.
        this.setVelocity(velocity.x * 0.2, velocity.y * 0.2);
    }
}