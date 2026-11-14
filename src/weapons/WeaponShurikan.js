import GameManager from '../things/GameManager.js';
import WeaponBase from './_weaponbase.js';
import ShurikanProjectile from './shurikanProjectile.js';

export default class WeaponShurikan extends WeaponBase {
    constructor(scene, player) {
        super(scene, player);
        this.name = 'shurikan';
        this.baseCooldown = 50;
        this.spamAdd = 90;
        this.chainCount = 1;
        this.initialTargets = 1

        this.setStats();
    }

    setStats() {
        if (GameManager.upgrades.shurikanUpgradeA) {
            this.chainCount = 5;
        } else {
            this.chainCount = 1;
        }
        if (GameManager.upgrades.shurikanUpgradeB) {
            this.baseDamage = 4;
        } else {
            this.baseDamage = 3;
        }
        if (GameManager.upgrades.shurikanUpgradeC) {
            this.initialTargets = 3;
        } else {
            this.initialTargets = 1;
        }
    }

    fire(pointer) {
        if (!this.canFire()) return;
        this.startCooldown();

        const { start, vector, direction } = this.calculateShot(pointer, 1000);

        const projectile = new ShurikanProjectile(this.scene, start.x, start.y, this.player,
            this,
            this.chainCount, 
            this.baseDamage,
            this.initialTargets, 
        );
        projectile.setVelocity(vector.x, vector.y);

        // Shard-shop Multishot line: +1 shurikan per throw per level,
        // fanned out at ±14° per extra (alternating sides). The extras
        // are full projectiles (same chain/damage/targets); like the
        // chain shurikens they are local-only — the network emit below
        // covers the main throw, same as before.
        const extras = this.shardMultishot();
        for (let i = 0; i < extras; i++) {
            const side = i % 2 === 0 ? 1 : -1;
            const step = Math.floor(i / 2) + 1;
            const a = side * step * 14 * Math.PI / 180;
            const cos = Math.cos(a), sin = Math.sin(a);
            const extra = new ShurikanProjectile(this.scene, start.x, start.y, this.player,
                this,
                this.chainCount,
                this.baseDamage,
                this.initialTargets,
            );
            extra.setVelocity(vector.x * cos - vector.y * sin, vector.x * sin + vector.y * cos);
        }

        this.player.network.socket.emit('shurikanthrow', { start, direction })

        this.playThrowSound();
    }
}
