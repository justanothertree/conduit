import BaseGame from "./_basegame.js";
import GameManager from "../things/GameManager.js";

// FLOWLINE — a movement-showcase level. Same scene recipe as the other
// levels; the design lives in public/assets/tilemapFlow.json (see
// tools/gen_flowline.py). Shard progress feeds PlayerUI's counter/banner;
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
        this.setupReturnPortal();
    }

    // Home return portal at the summit (near the finish line), so players
    // can get back without using the menu.
    setupReturnPortal() {
        if (!this.portals) {
            this.portals = this.physics.add.staticGroup();
        }
        const portal = this.portals.create(4900, 1100, 'portal3')
            .setScale(.2)
            .play('portal3')
            .setTint(0x7CFC00);
        portal.targetScene = 'Home';
        this.shrinkCollision(portal, 140, 140);

        this.physics.add.overlap(this.player, this.portals, (player, p) => {
            if (p.targetScene && this.scene.key !== p.targetScene) {
                GameManager.useLastLocation = false;
                GameManager.save();
                this.scene.start(p.targetScene);
            }
        });

        this.add.text(4900, 1020, 'HOME', {
            fontSize: '18px',
            color: '#7CFC00',
            fontStyle: 'bold',
        }).setOrigin(.5);
    }

    flowShardsFound() {
        return GameManager.collectedItems.filter(
            (id) => typeof id === 'string' && id.startsWith('flow-')).length;
    }

    // Called by Shard pickups (via scene.onShardCollected?.()). The counter
    // and banner live in PlayerUI now; the reward behavior is unchanged.
    onShardCollected() {
        this.playerUI?.updateShardHud?.();
        const found = this.flowShardsFound();
        if (found >= this.shardTotal && !GameManager.flags.flowComplete) {
            GameManager.flags.flowComplete = true;
            GameManager.power.money += 500;
            GameManager.save();
            this.playerUI?.showShardBanner?.();
            const cam = this.cameras.main;
            for (let i = 0; i < 5; i++) {
                this.spawnManager.spawnCard(
                    cam.scrollX + cam.width / 2 + (Math.random() * 240 - 120),
                    cam.scrollY + cam.height / 2 - 120);
            }
        }
    }
}
