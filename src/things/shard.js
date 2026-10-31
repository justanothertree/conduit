import { getProperty } from "../myFunctions";
import GameManager from "./GameManager";
import Pickup from "./Pickup";

// A Flowline shard: a persistent collectible. The first time the player
// grabs one, its id lands in GameManager.collectedItems (which the save
// system already persists) — so shard progress survives between runs.
// Re-entering the level never re-spawns found shards (see spawnShard);
// every pickup still pays a small money/health reward like a coin.
export default class Shard extends Pickup {
    constructor(scene, x, y, obj) {
        super(scene, x, y, 'coin');
        const props = getProperty(obj);
        this.shardId = props?.id ?? `flow-${Math.round(x)}-${Math.round(y)}`;
        this.setTint(0x00ffff);
        this.setScale(.35);
        scene.tweens.add({
            targets: this,
            y: y - 8,
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inout',
        });
    }

    playerCollide(player) {
        player.updateMoney(25);
        player.adjustHealth(5);
        this.playPickupSound();
        if (!GameManager.collectedItems.includes(this.shardId)) {
            GameManager.collectedItems.push(this.shardId);
        }
        GameManager.save();
        this.scene.onShardCollected?.(this.shardId);
        this.emit('pickup');
        this.destroy();
    }

    hit() { }
}
