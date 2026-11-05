import BaseGame from "./_basegame.js";
import GameManager from "../things/GameManager.js";

// WORLD 1 — a combat-forward level. Same scene recipe as LevelFlow; the
// design lives in public/assets/tilemapWorld1.json (see
// tools/gen_world1.py). Turret alleys, a lava pit, a charger den, and the
// Iron Warden (Boss2) at the end, split into ~1-minute legs by 4
// checkpoints so a phone run takes ~3-5 minutes.
//
// Checkpoints: SpawnManager.spawnCheckpoint records the respawn point on
// GameManager.checkpoint (session-only). This scene's spawnPlayer override
// prefers the recorded checkpoint over the map's spawn point; fresh
// entries (Home portal, ?scene=) clear it, so a new run always starts at
// the breach.
//
// Shard progress feeds PlayerUI's counter/banner (shardTotal + the
// flowShardsFound() hook PlayerUI calls — it counts this level's 'w1-'
// ids); shard persistence itself lives in GameManager.collectedItems.
export default class World1 extends BaseGame {
    constructor() {
        super('World1');
        this.shardTotal = 12;
        this.shardBannerText = 'WORLD 1 COMPLETE!';
    }

    create() {
        this.setupSky();
        this.setupWorld(0, 0, 4480, 2560);
        this.setupPlayer();
        this.setupGroups();
        this.setupTileMap('tilemapWorld1');
        this.setupCollisions();
        this.setupMusic('music1');
        this.setupNet();
        this.setupReturnPortal();
    }

    // Checkpoint-aware spawn: the setupTileMap dispatch falls back to this
    // scene method (SpawnManager has no spawnPlayer). A checkpoint recorded
    // earlier in this run takes precedence over the map's spawn point.
    spawnPlayer(x, y) {
        const cp = GameManager.checkpoint;
        if (cp && cp.scene === 'World1') {
            super.spawnPlayer(cp.x, cp.y);
        } else {
            super.spawnPlayer(x, y);
        }
    }

    // Home return portal in the vault (past the boss arena), so players can
    // get back without using the menu.
    setupReturnPortal() {
        if (!this.portals) {
            this.portals = this.physics.add.staticGroup();
        }
        const portal = this.portals.create(4224, 2048, 'portal3')
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

        this.add.text(4224, 1968, 'HOME', {
            fontSize: '18px',
            color: '#7CFC00',
            fontStyle: 'bold',
        }).setOrigin(.5);
    }

    w1ShardsFound() {
        return GameManager.collectedItems.filter(
            (id) => typeof id === 'string' && id.startsWith('w1-')
                && !id.startsWith('w1boss-')).length;
    }

    // PlayerUI's shard HUD calls this hook by name; count World 1's ids.
    flowShardsFound() {
        return this.w1ShardsFound();
    }

    // Called by Shard pickups (via scene.onShardCollected?.()). The counter
    // and banner live in PlayerUI now; the reward behavior mirrors
    // Flowline's (one-time 500-money completion bonus).
    onShardCollected() {
        this.playerUI?.updateShardHud?.();
        const found = this.w1ShardsFound();
        if (found >= this.shardTotal && !GameManager.flags.world1Complete) {
            GameManager.flags.world1Complete = true;
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
