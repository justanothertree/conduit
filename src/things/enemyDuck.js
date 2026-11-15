import BaseEnemy from "./_baseEnemy.js";

export default class Duck extends BaseEnemy {
    constructor(scene, x, y, health) {
        super(scene, x, y, 'duck');
        this.maxHealth = health;
        this.health = health;

        this.setScale(.3);

    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        // Remote puppet: BaseEnemy.preUpdate already lerped toward
        // the host position — no patrol, no chase.
        if (this.isRemote) return;
        this.patrol(time);
        this.chasePlayer(time);
    }

    playerCollide(player) {
        const direction = new Phaser.Math.Vector2(player.x - this.x, player.y - this.y);
        const knockback = direction.normalize().scale(600);

        player.TakeDamage(knockback.x, knockback.y, 5);
    }

}