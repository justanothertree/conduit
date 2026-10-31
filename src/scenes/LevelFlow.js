import BaseGame from "./_basegame.js";
import GameManager from "../things/GameManager.js";

// FLOWLINE — a movement-showcase level. Same scene recipe as the other
// levels; the design lives in public/assets/tilemapFlow.json (see
// tools/gen_flowline.py). Adds a shard HUD and a completion celebration;
// shard persistence itself lives in GameManager.collectedItems.
export default class LevelFlow extends BaseGame {
    constructor() {
        super('LevelFlow');
        this.shardTotal = 12;
    }

    create() {
        this.setupSky();
        this.setupWorld(0, 0, 5120, 3200);
        this.setupPlayer();
        this.setupGroups();
        this.setupTileMap('tilemapFlow');
        this.setupCollisions();
        this.setupMusic('music1');
        this.setupNet();
        this.setupShardHud();
    }

    setupShardHud() {
        const found = this.flowShardsFound();
        // Below playerUI's score text (10,50, two 32px lines) — left HUD column.
        this.shardText = this.add.text(16, 128, `◆ ${found}/${this.shardTotal}`, {
            fontSize: '22px',
            color: '#00ffff',
            fontStyle: 'bold',
            stroke: '#003333',
            strokeThickness: 4,
        }).setScrollFactor(0).setDepth(1000);
    }

    flowShardsFound() {
        return GameManager.collectedItems.filter(
            (id) => typeof id === 'string' && id.startsWith('flow-')).length;
    }

    // Called by Shard pickups (via scene.onShardCollected?.()).
    onShardCollected() {
        const found = this.flowShardsFound();
        this.shardText?.setText(`◆ ${found}/${this.shardTotal}`);
        if (found >= this.shardTotal && !GameManager.flags.flowComplete) {
            GameManager.flags.flowComplete = true;
            GameManager.power.money += 500;
            GameManager.save();
            const cam = this.cameras.main;
            this.add.text(cam.width / 2, cam.height / 2 - 60, 'FLOWLINE COMPLETE!', {
                fontSize: '36px',
                color: '#ffff00',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 6,
            }).setOrigin(.5).setScrollFactor(0).setDepth(1001);
            for (let i = 0; i < 5; i++) {
                this.spawnManager.spawnCard(
                    cam.scrollX + cam.width / 2 + (Math.random() * 240 - 120),
                    cam.scrollY + cam.height / 2 - 120);
            }
        }
    }
}
