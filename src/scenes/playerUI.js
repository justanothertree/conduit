import GameManager from "../things/GameManager.js";
import NetworkManager from "../things/NetworkManager.js";
import { getRank } from "../things/RankSystem.js";
import { isTouchDevice } from "../domStuff/TouchControls.js";

// Reads env(safe-area-inset-left) — 0 on devices without a notch. The
// Phaser canvas is full-bleed (viewport-fit=cover), so the left HUD
// column (score / shard counter / health bar) can sit under a landscape
// notch. Cached; resetSafeAreaCache() runs on resize since rotating the
// phone changes which edge has the inset.
let _safeLeftCache = null;
export function safeAreaLeft() {
    if (_safeLeftCache !== null) return _safeLeftCache;
    let v = 0;
    try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;';
        // Unsupported browsers ignore the env() assignment and keep left:0.
        probe.style.left = 'env(safe-area-inset-left, 0px)';
        document.body.appendChild(probe);
        v = probe.getBoundingClientRect().left || 0;
        probe.remove();
    } catch { v = 0; }
    _safeLeftCache = v;
    return v;
}
function resetSafeAreaCache() {
    _safeLeftCache = null;
}

// Height of the touch action-button cluster (#tc-actions in
// touchControls.css: 190px tall, 16px off the bottom, scaled by the touch
// Size setting) plus a margin. Used to lift the Slot 2 weapon icon above
// the buttons on touch devices; 0 on desktop.
function touchClusterLift() {
    if (!isTouchDevice()) return 0;
    let size = 1;
    try {
        size = JSON.parse(localStorage.getItem('conduitTouchSettings') || '{}').size || 1;
    } catch { /* default */ }
    return Math.ceil(16 + 190 * size) + 8;
}

export default class PlayerUI extends Phaser.Scene {
    constructor() {
        super('PlayerUI');
        this.player = null;
        this.gameScene = null;
    }
    init(data) {
        // init runs on every level load (setupPlayer re-calls it manually
        // when PlayerUI is already active), so each call hands this scene a
        // fresh player — but the previous player's handlers were never
        // detached, leaving orphaned listeners on every discarded player.
        // Replace (not stack), same convention as Inventory's Day 23 fix:
        // detach from the old player first, then subscribe to the new one.
        if (this.player && this._healthHandler) {
            this.player.off('updateHealth', this._healthHandler);
        }
        if (this.player && this._moneyHandler) {
            this.player.off('moneyChanged', this._moneyHandler);
        }
        this.player = data.player;
        this.gameScene = data.gameScene;
        this.player.playerUI = this;

        this.healthBoxUpdate(this.player.health, this.player.healthMax);
        this._healthHandler = (health, max) => {
            this.healthBoxUpdate(health, max)
        };
        this._moneyHandler = (v) => {
            const money = GameManager.power.money
            this.scoreText.text = 'Source: ' + (money) + '\n' + getRank(money);
        };
        this.player.on('updateHealth', this._healthHandler);
        this.player.on('moneyChanged', this._moneyHandler);
        // A leftover boss bar from a previous level must not survive a restart.
        this.hideBossBar();
        // Same for the shard HUD: shard levels rebuild it below, other
        // levels show nothing.
        this.hideShardHud();
        this.setupShardHud();
    }

    create() {
        this.visible = true;
        this.chatting = false;
        this.playerList = [];
        this.network = NetworkManager.instance;
        this.playerHealthBGMap = {};
        this.playerHealthMap = {};
        this.playerTextMap = {}; // Object to hold playerId => textObject

        this.setWeaponIcon(this.player.leftWeapon.name, 0);
        // Slot 2 can be empty — same null class as the WHIP/pointer fixes
        // (Player.js guards this.rightWeapon in its hot paths).
        if (this.player.rightWeapon) {
            this.setWeaponIcon(this.player.rightWeapon.name, 1);
        }

        this.leftWeaponBox = this.add.graphics().setDepth(1);
        this.rightWeaponBox = this.add.graphics().setDepth(1);



        this.fpsText = this.add.text(0, 0, '', { font: '24px Courier' });
        this.fpsText.setScrollFactor(0);
        this.time.addEvent({
            delay: 200,
            loop: true,
            callback: () => {
                let hardwareAccellWarning = '';
                if (this.game.loop.actualFps < 30) {
                    hardwareAccellWarning = '   TURN ON HARDWARE ACCELERATION!!';
                    this.fpsText.setColor('#FF0000');
                }
                this.fpsText.setText(`FPS: ${Math.floor(this.game.loop.actualFps)}` + hardwareAccellWarning
                    + '\nLoc: ' + Math.round(this.player.x) + ', ' + Math.round(this.player.y));
            }
        });

        this.scoreText = this.add.text(this.hudLeft() + 10, 50, 'Source: ' + GameManager.power.money + '\n' + getRank(GameManager.power.money), {
            fontSize: '32px',
            color: '#4fffff'
        });
        this.scoreText.setScrollFactor(0);


        this.textBoxX = this.scale.width / 2
        this.textBoxY = this.scale.height / 2 + 100;

        this.scale.on('resize', this.resizeUI, this);

        this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => this.updatePlayerList()
        });
        this.network.on('healthChanged', () => {
            this.updatePlayerList();
        })

    }

    update() {
        super.update();
        this.cooldownRed(true);
        this.cooldownRed(false);
        this.updateBossBar();


    }

    // Left HUD column x offset: score text, shard counter, and health
    // bar all clear a landscape notch via the safe-area probe. 0 on
    // notch-less devices, so Josh's layout is unchanged there.
    hudLeft() {
        return safeAreaLeft();
    }

    // ---- Boss HP bar: big, top-center, only visible while a boss fight is
    // live. The boss calls showBossBar on activate and hideBossBar on
    // death/deactivate; update() keeps the fill current and drops the bar
    // if the boss is gone.
    //
    // Narrow screens: the 60px touch pause button sits top-right, so the
    // bar centers in the space left of it instead of true center (where
    // it would render underneath the button). Desktop widths keep cx at
    // true center — unchanged.
    bossBarCx() {
        const w = this.scale.width;
        return w < 520 ? (w - 84) / 2 : w / 2;
    }

    bossBarW() {
        const w = this.scale.width;
        // Narrow: the bar must fit left of the pause button, not just
        // centered clear of it — otherwise it overflows the left edge.
        return Math.min(600, w < 520 ? w - 84 : w - 40);
    }

    showBossBar(boss) {
        this.hideBossBar();
        this._boss = boss;
        const w = this.bossBarW();
        const cx = this.bossBarCx();
        this.bossBarBg = this.add.rectangle(cx, 28, w, 22, 0x000000, 0.7)
            .setScrollFactor(0).setDepth(1000);
        this.bossBar = this.add.rectangle(cx - (w - 4) / 2, 28, w - 4, 16, 0xcc22cc, 1)
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);
        this.bossBarWidth = w - 4;
        this.bossText = this.add.text(cx, 6, 'BOSS', {
            fontSize: '18px',
            color: '#ff66ff',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1001);
        this.updateBossBar();
    }

    updateBossBar() {
        if (!this._boss || this._boss.dead || !this.bossBar) {
            if (this._boss) this.hideBossBar();
            return;
        }
        const frac = Phaser.Math.Clamp(this._boss.health / this._boss.maxHealth, 0, 1);
        this.bossBar.setScale(frac, 1);
    }

    hideBossBar() {
        this._boss = null;
        this.bossBarBg?.destroy();
        this.bossBar?.destroy();
        this.bossText?.destroy();
        this.bossBarBg = null;
        this.bossBar = null;
        this.bossText = null;
    }

    // ---- Shard counter + completion banner (Flowline). Levels with
    // collectible shards set `shardTotal` and `flowShardsFound()` on the
    // game scene (LevelFlow does); every other level shows nothing. The
    // data model is untouched — counts still come from
    // GameManager.collectedItems.
    setupShardHud() {
        const gs = this.gameScene;
        this.shardTotal = gs?.shardTotal ?? 0;
        if (!this.shardTotal) return;
        const found = gs.flowShardsFound?.() ?? 0;
        // Left HUD column: score (y=50, two 32px lines ends ~130), health
        // bar (y=150, 25 tall ends at 175) — so the counter sits BELOW the
        // bar at y=186 instead of overlapping it. "◆ 12/12" at 22px is
        // ~100px wide, fits a 360px screen. The x clears a landscape notch
        // via hudLeft() (0 on notch-less devices).
        this.shardText = this.add.text(this.hudLeft() + 12, 186, `◆ ${found}/${this.shardTotal}`, {
            fontSize: '22px',
            color: '#00ffff',
            fontStyle: 'bold',
            stroke: '#003333',
            strokeThickness: 4,
        }).setScrollFactor(0).setDepth(1000);
    }

    updateShardHud() {
        if (!this.shardText) return;
        const found = this.gameScene?.flowShardsFound?.() ?? 0;
        this.shardText.setText(`◆ ${found}/${this.shardTotal}`);
    }

    hideShardHud() {
        this.shardText?.destroy();
        this.shardText = null;
        this.shardBanner?.destroy();
        this.shardBanner = null;
        this.shardTotal = 0;
    }

    // "FLOWLINE COMPLETE!" — centered (clear of notch/cutout edges), sized
    // to fit a 360px phone, fades out after a few seconds. Levels with
    // their own completion text set `shardBannerText` on the game scene
    // (World1 does); Flowline's label is the default.
    showShardBanner() {
        this.shardBanner?.destroy();
        const w = this.scale.width, h = this.scale.height;
        const size = Math.max(20, Math.min(36, Math.floor(w / 12)));
        const label = this.gameScene?.shardBannerText ?? 'FLOWLINE COMPLETE!';
        this.shardBanner = this.add.text(w / 2, h * 0.35, label, {
            fontSize: `${size}px`,
            color: '#ffff00',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 6,
        }).setOrigin(.5).setScrollFactor(0).setDepth(1001);
        this.tweens.add({
            targets: this.shardBanner,
            alpha: 0,
            delay: 2500,
            duration: 900,
            onComplete: () => {
                this.shardBanner?.destroy();
                this.shardBanner = null;
            },
        });
    }

    resizeUI(gamesize) {
        const { width, height } = gamesize;
        // Rotation can move the notch to a different edge — recompute.
        resetSafeAreaCache();
        if (this.scoreText) this.scoreText.x = this.hudLeft() + 10;
        if (this.shardText) this.shardText.x = this.hudLeft() + 12;
        if (this.healthBg) this.healthBg.x = this.hudLeft();
        if (this.healthBox) this.healthBox.x = this.hudLeft();
        if (!this.leftWeaponBox || !this.leftWeaponIcon || !this.rightWeaponBox || !this.rightWeaponIcon) return;
        this.leftWeaponBox.y = height;
        this.leftWeaponIcon.y = height;
        this.rightWeaponBox.x = width;
        // Touch: the Slot 2 icon lives above the action-button cluster
        // (see touchClusterLift); desktop keeps it bottom-right.
        this.rightWeaponBox.y = height - touchClusterLift();
        this.rightWeaponIcon.x = width;
        this.rightWeaponIcon.y = height - touchClusterLift();
        this.textBoxX = width / 2;
        this.textBoxY = height / 2 + 100;
        // Keep the boss bar centered if the window/phone rotates mid-fight.
        const cx = this.bossBarCx();
        if (this.bossBarBg) this.bossBarBg.x = cx;
        if (this.bossBar && this.bossBarWidth) this.bossBar.x = cx - this.bossBarWidth / 2;
        if (this.bossText) this.bossText.x = cx;
    }

    setWeaponIcon(name = 'shurikan', slot = 0) {
        const icon = name + 'icon'
        if (slot === 0) {
            if (!this.leftWeaponIcon) {
                this.leftWeaponIcon = this.add.image(0, this.scale.height, icon).setOrigin(0, 1).setScale(.5);
            } else {
                this.leftWeaponIcon.setTexture(icon)
            }
        } else {
            if (!this.rightWeaponIcon) {
                // Touch: lift the Slot 2 icon above the action-button
                // cluster, which otherwise covers it (see
                // touchClusterLift). Desktop keeps it bottom-right.
                this.rightWeaponIcon = this.add.image(this.scale.width, this.scale.height - touchClusterLift(), icon).setOrigin(1, 1).setScale(.5);
            } else {
                this.rightWeaponIcon.setTexture(icon)
            }
        }
    }

    cooldownRed(left) {
        const weaponBox = left ? this.leftWeaponBox : this.rightWeaponBox;
        const weaponIcon = left ? this.leftWeaponIcon : this.rightWeaponIcon;
        // Slot 2 can be empty; this runs every frame, so guard before touching.
        const weapon = left ? this.player.leftWeapon : this.player.rightWeapon;
        if (!weaponIcon || !weapon) return;
        const cdProgress = weapon.cdProgress;
        if (cdProgress > .95) {
            weaponBox.clear();
            return;
        }
        weaponBox.clear();

        if (cdProgress > 0) {
            const fillHeight = cdProgress * weaponIcon.displayHeight;

            // fillX is based on the weapon icon origin
            const fillX = left
                ? weaponIcon.x
                : weaponIcon.x - weaponIcon.displayWidth;

            const fillY = weaponIcon.y - fillHeight;

            weaponBox.fillStyle(0xff0000, 0.5);
            weaponBox.fillRect(fillX, fillY, weaponIcon.displayWidth, fillHeight);
        }
    }

    openTextChat() {
        if (this.chatting) return;
        this.player.chatting = true;

        this.chatting = true;
        this.events.emit('chatting');

        if (!this.cache.html.exists('textchat')) {
            this.textBox = this.add.dom(this.textBoxX, this.textBoxY).createFromHTML(`
            <input 
            type="text" 
            id="textchat" 
            name="textchat" 
            placeholder="Chat.."
            maxlength="200"
            style="font-size: 20px; width: 300px; padding: 5px;" />
        `);
        } else {
            this.textBox = this.add.dom(this.textBoxX, this.textBoxY).createFromCache('textchat');
        }

        const input = this.textBox.node?.querySelector('#textchat');
        if (!input) {
            console.error('Input element not found!');
            this.chatting = false;
            this.events.emit('doneChatting');
            return;
        }

        input.focus();
        this.inputFocused = true;
    }


    closeTextChat(message) {
        this.player.chatting = false;
        if (this.textBox) {
            this.textBox.destroy();
            this.textBox = null;
            this.inputFocused = false;
        }
        this.chatting = false;

        if (!message) return;

        this.player.makeChatBubble(message);


    }

    updatePlayerList() {
        const otherPlayers = this.network.otherPlayers;
        if (!otherPlayers) return;

        const activeIds = new Set();

        Object.entries(otherPlayers).forEach(([id, player], index) => {
            const playerId = String(id); // ensure string consistency
            const yloc = index * 50 + 200;
            activeIds.add(playerId);
            if (this.playerHealthMap[playerId]) {
                const healthObj = this.playerHealthMap[playerId];
                const playerHealth = player.health || 0;
                const playerHealthMax = player.healthMax || 1; // Avoid division by zero
                const percentHealth = playerHealth / playerHealthMax;
                healthObj.width = percentHealth * 200;
            } else {
                const healthBG = this.add.rectangle(0, yloc, 200, 25, 0x000000, .7).setOrigin(0, 0);
                const healthObj = this.add.rectangle(0, yloc, 200, 25, 0x007700).setOrigin(0, 0);
                this.playerHealthMap[playerId] = healthObj;
                this.playerHealthBGMap[playerId] = healthBG;
            }

            if (this.playerTextMap[playerId]) {
                const textObj = this.playerTextMap[playerId];
                textObj.setText(player.nameText + ' - ' + player.money);
                textObj.setY(yloc);
                textObj.setColor(player.nameColor);
            } else {
                const textObj = this.add.text(0, yloc, player.nameText + ' - ' + player.money, {
                    fontSize: '25px',
                    fill: '#FFFFFF',
                    shadow: {
                        offsetX: -1,
                        offsetY: 1,
                        color: '#111111',
                        blur: true,
                        stroke: true,
                    }
                });
                this.playerTextMap[playerId] = textObj;
            }
        });

        // Clean up any removed players' text
        for (const id in this.playerTextMap) {
            if (!activeIds.has(id)) {
                this.playerTextMap[id]?.destroy();
                delete this.playerTextMap[id];
                this.playerHealthMap[id]?.destroy();
                delete this.playerHealthMap[id];
                this.playerHealthBGMap[id]?.destroy();
                delete this.playerHealthBGMap[id];
            }
        }
    }

    healthBoxUpdate(health, max) {
        // hx shifts the bar clear of a landscape notch (hudLeft); the
        // Graphics object is drawn at local coords and shifted via .x so
        // the per-frame fill math below stays unchanged.
        const hx = this.hudLeft();
        if (!this.healthBg) {
            this.healthBg = this.add.rectangle(0, 150, 300, 25, 0x000000, .8).setDepth(1).setOrigin(0, 0);
            this.healthBg.x = hx;
        }
        if (!this.healthBox) {
            this.healthBox = this.add.graphics().setDepth(2).fillStyle('0x00FF00', 1);
            this.healthBox.fillRect(0, 150, 300, 25);
            this.healthBox.x = hx;
        }
        const percentHealth = health / max;
        this.healthBox.clear();
        this.healthBox.fillStyle(0x00FF00, 1);
        this.healthBox.fillRect(0, 150, 300 * percentHealth, 25);
    }

}

