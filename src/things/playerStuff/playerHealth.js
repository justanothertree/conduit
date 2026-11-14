// playerHealth.js — health/damage logic extracted from Player.
// Behavior-preserving move (2026-09-27): every `this` was the player.
// External callers (enemies, bullets, NetworkManager) keep working because
// Player keeps thin wrappers with the original method names.

import GameManager from "../GameManager.js";
import { playSound } from "../soundUtils.js";

export function playerAdjustHealth(player, amount) {

    player.health = Phaser.Math.Clamp(player.health + amount, 0, player.healthMax);
    GameManager.stats.health = player.health;
    player.emit('updateHealth', player.health, player.healthMax);
    player.network.socket.emit('updateHealth', player.health, player.healthMax);

    return player.health;
}

export function playerTakeDamage(player, x, y, damage, stunDuration, actor) {
    if (player.scene.physics.isPaused) return false;
    if (player.iFrame) return false;
    if (player.hitCD) return false;
    if (!player.alive) return false;

    player.hitCD = true;
    player.setTint('0xFF0000');
    player.scene.time.addEvent({
        delay: 500,
        callback: () => {
            player.hitCD = false;
            if (player.canDash) {
                if (!player.alive) return;
                player.setTint(player.buffColor);
            } else {
                player.setTint();
            }
        }
    });

    if (player.adjustHealth(-damage) === 0) {
        // Shard-shop Second Wind: cheat death once per life. A fatal hit
        // instead leaves the player standing at 5 + 5 per level HP
        // (10/15/20 — must match the Second Wind desc in shardShop.js),
        // with 1.5s of i-frames to get clear. The per-life flag lives on
        // the player and resets with it on respawn (see Player's
        // constructor); without the flag the line would be infinite lives.
        // The rest of the damage feedback below (money loss, flash,
        // sound, knockback) still runs — only Died() is skipped.
        const sw = GameManager.upgrades?.shardShop?.secondWind ?? 0;
        if (sw > 0 && !player._secondWindUsed) {
            player._secondWindUsed = true;
            player.adjustHealth(5 + 5 * sw);
            player.iFrame = true;
            player.scene.time.delayedCall(1500, () => { player.iFrame = false; });
            const label = player.scene.add.text(player.x, player.y - 60, 'SECOND WIND!', {
                fontSize: '28px',
                color: '#7dff9a',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 5,
            }).setOrigin(.5);
            player.scene.tweens.add({
                targets: label,
                alpha: 0,
                y: player.y - 110,
                delay: 900,
                duration: 600,
                onComplete: () => label.destroy(),
            });
        } else {
            player.Died(actor);
        }
    }

    player.updateMoney(-damage);

    player.makeScreenFlash();
    playSound(player.scene, player.damageSound);

    if (player.currentState === 'meditate') return true;

    if (stunDuration > 0) {
        player.stunned = true;
        player.emit('playerstunned');
        player.stop();
        player.setFrame(8);
        player.scene.time.removeEvent(player.stunTimer);
        player.stunTimer = player.scene.time.addEvent({
            delay: stunDuration,
            callback: () => {
                player.stunned = false;
                player.setFrame(5);
            }
        });
    }

    player.setVelocityX(x);
    player.setVelocityY(y);


    return true;
}

export function playerUpdateHealth(player, value) {
    if (player.health >= player.healthMax) return;
    player.health += value;
    GameManager.stats.health = player.health;
    player.emit('updateHealth', player.health, player.healthMax);
    player.network.socket.emit('updateHealth', player.health, player.healthMax);
}
