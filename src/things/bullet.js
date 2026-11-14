export default class Bullet extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, texture = 'bullet') {
        super(scene, x, y, texture)
        scene.add.existing(this);
        scene.physics.add.existing(this);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);

        // Fireballs are drawn pointing LEFT (dense head on the left, flame
        // tail trailing right), so a shot flying down or right reads as
        // sideways unless the sprite is rotated to face its velocity.
        // Rotate every frame — one atan2 per bullet (≤36 live boss shots)
        // — and it covers every fireball source at once: both bosses,
        // turret, bomber, miniboss, and the level fireball spawners.
        // The plain 'bullet' round is symmetric, so only the fireball
        // sheet needs it. Arcade bodies stay axis-aligned; this rotates
        // the display only. (+180 because the art natively points left.)
        if (this.texture.key === 'fireballsheet' && this.body) {
            const v = this.body.velocity;
            if (v.x !== 0 || v.y !== 0) {
                this.setAngle(Phaser.Math.RadToDeg(Math.atan2(v.y, v.x)) + 180);
            }
        }

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

    playerCollide(player) {
        if (player.TakeDamage(-500, -150))
            this.destroy();
    }
}