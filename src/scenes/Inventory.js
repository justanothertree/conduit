import GameManager from "../things/GameManager";
import { weaponUpgrades } from '../weapons/WeaponManager'
import {
    openInventoryPanel,
    closeInventoryPanel,
    isInventoryPanelOpen,
    refreshInventoryPanel,
} from "../domStuff/inventoryPanel.js";

// Inventory — now a responsive DOM panel (not a Phaser canvas).
//
// The old canvas layout (content around x=1200) needed camera-zoom hacks
// on phones and still wasn't tappable. The panel is DOM at z-index 20
// (above the touch overlay), max-width min(480px, 94vw), 44px+ targets —
// same pattern as #shard-shop.
//
// This stays a Phaser Scene because _basegame.js references it via
// scene.get('Inventory') and Player reads player.inventory. The scene
// itself renders nothing; it owns the panel lifecycle and the purchase/
// reset game logic.
//
// IMPORTANT: create() no longer calls scene.setActive(false). Deactivating
// made !scene.isActive('Inventory') in _basegame re-run create() without
// shutdown on every respawn/portal, stacking keydown-ESC listeners.

export default class Inventory extends Phaser.Scene {
    constructor() {
        super('Inventory');
        this.player = null;
        this._selectedTalent = null;
        this._escHandler = null;
    }

    init(data) {
        // Re-run on every level load with the new player (see _basegame).
        // If the panel is open across a level change, re-render it for
        // the new player instead of going stale.
        if (this.player && this._moneyChangedHandler) {
            this.player.off('moneyChanged', this._moneyChangedHandler);
        }
        this.player = data.player;
        if (this.player) this.player.inventory = this;
        this._moneyChangedHandler = () => refreshInventoryPanel(this);
        this.player?.on('moneyChanged', this._moneyChangedHandler);
        if (isInventoryPanelOpen()) refreshInventoryPanel(this);
    }

    create() {
        // Nothing on canvas. Panel is DOM; shutdown removes it.
        this.events.once('shutdown', () => this.closePanel());

        // Escape closes the panel (desktop + touch Settings key).
        this._escHandler = () => this.closePanel();
        this.input.keyboard.on('keydown-ESC', this._escHandler);
        this.events.once('shutdown', () => {
            this.input.keyboard.off('keydown-ESC', this._escHandler);
        });
    }

    openPanel() {
        if (!this.player) return;
        this._selectedTalent = null;
        openInventoryPanel(this);
    }

    closePanel() {
        this._selectedTalent = null;
        closeInventoryPanel();
    }

    isPanelOpen() {
        return isInventoryPanelOpen();
    }

    purchaseUpgrade(upgrade) {
        const { id, cost, maxRank, apply } = upgrade;
        const realCost = typeof cost === 'function' ? cost() : cost;
        const currentRank = GameManager.upgrades[id] ?? 0;
        const maxed = upgrade.maxRank >= 0 && currentRank >= maxRank;

        // Block either/or losers (e.g. A2 after A1 is maxed).
        const blocked = weaponUpgrades.some((u) => {
            const c = GameManager.upgrades[u.id] ?? 0;
            return u.maxRank >= 0 && c >= u.maxRank && u.disables?.includes(id);
        });
        if (blocked) {
            this.sound.play('clinksound');
            return false;
        }

        if (!maxed && GameManager.power.money >= realCost) {
            this.player.updateMoney(-realCost);
            GameManager.power.spent += realCost;
            apply(this);

            if (disables) {
                // disables handled visually by the panel re-render
            }

            this.player.leftWeapon.setStats();
            this.player.rightWeapon.setStats();
            this.player.aura.setStats();

            this.sound.play('pickup');
            GameManager.save();
            return true;
        }
        this.sound.play('clinksound');
        return false;
    }

    resetAllUpgrades() {
        // Preserve Shard Shop progress — wiping upgrades.shardShop and
        // upgrades.shardsSpent here refunded all 12 shards while
        // stats.healthMax stayed raised, allowing infinite Max HP
        // stacking. Only Source talents reset.
        const keepShardShop = GameManager.upgrades.shardShop;
        const keepShardsSpent = GameManager.upgrades.shardsSpent;
        GameManager.upgrades = {};
        if (keepShardShop) GameManager.upgrades.shardShop = keepShardShop;
        if (keepShardsSpent) GameManager.upgrades.shardsSpent = keepShardsSpent;

        // Run each talent's reset() so auraLevel etc. go back to base.
        weaponUpgrades.forEach((u) => u.reset?.());
        GameManager.power.auraLevel = 1;

        // healthMax is derived live in Player.setStats() from
        // upgrades.shardShop.maxHealth — no stored value to fix up.
        this.player.setStats();

        // Refund half of Source spent (Source talents only; shards are
        // never refunded — they're finite).
        this.player.updateMoney(GameManager.power.spent / 2);
        GameManager.power.spent = 0;

        GameManager.save();
        this.sound.play('clinksound2');
    }
}
