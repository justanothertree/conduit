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
        player.Died(actor);
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
