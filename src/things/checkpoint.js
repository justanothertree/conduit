import GameManager from "./GameManager.js";

// WORLD 1 checkpoint: a per-run respawn marker.
//
// Touching it records the respawn position on GameManager.checkpoint — a
// session-only field (never serialized by save()/load(), so a fresh level
// entry always starts at the map's spawn point; Home's portal overlap and
// the ?scene= path null it on entry). World1.spawnPlayer (the scene method
// reached via the setupTileMap dispatch fallback) prefers the recorded
// checkpoint over the map's spawn point.
//
// Checkpoints are monotonic: each carries an `index` prop emitted in level
// order by the map generator, and only a checkpoint at least as far along
// as the current one can move the respawn point — backtracking through an
// earlier checkpoint can't downgrade your respawn.
//
// Visual: a bobbing source orb (existing art) with a label — dim grey
// until touched, then bright green with a check. No new art.
export default class Checkpoint {
    constructor(scene, x, y, index = 0) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.index = index;
        this.activated = false;

        this.orb = scene.add.sprite(x, y - 24, 'sourceOrb')
            .setScale(.4)
            .setAlpha(.45);
        scene.tweens.add({
            targets: this.orb,
            y: y - 32,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inout',
        });
        this.label = scene.add.text(x, y - 62, 'CHECKPOINT', {
            fontSize: '14px',
            color: '#888888',
            fontStyle: 'bold',
        }).setOrigin(.5);

        this.zone = scene.add.zone(x, y - 16, 130, 130);
        scene.physics.add.existing(this.zone, true); // static
        this.overlap = scene.physics.add.overlap(
            scene.player, this.zone, () => this.activate());

        scene.events.once('shutdown', () => this.destroy());
    }

    activate() {
        const cur = GameManager.checkpoint;
        const key = this.scene.scene.key;
        // Monotonic: never move the respawn point backwards.
        if (cur && cur.scene === key && (cur.index ?? -1) > this.index) return;
        GameManager.checkpoint = {
            scene: key,
            x: this.x,
            y: this.y - 40,
            index: this.index,
        };
        if (!this.activated) {
            this.activated = true;
            this.orb.setAlpha(1).setTint(0x00ff88);
            this.label.setColor('#00ff88').setText('✓ CHECKPOINT');
        }
    }

    destroy() {
        this.orb?.destroy();
        this.label?.destroy();
        this.zone?.destroy();
        this.overlap?.destroy();
    }
}
