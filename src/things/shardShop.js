// shardShop.js — the Shard Shop in Home.
//
// A shard-keeper crystal the player walks up to and interacts with (F key,
// or the touch menu's Interact entry — same interactGroup convention as the
// devil shop). Interacting opens a DOM shop panel (src/domStuff/shardShop.css)
// where Flowline and World 1 shards can be spent on four upgrade lines:
// Aura, Max Health, Damage, Cooldown. DOM, not canvas, so taps land on phones: the panel sits at
// z-index 20, above the touch overlay (z-index 10), and needs no changes to
// the touch joystick-zone menu-open polling.
//
// Spend design: GameManager.collectedItems stays the permanent "found"
// record (the Flowline HUD's ◆ n/12 is found count and never changes on
// spend). Spending is tracked separately, in the already save-persisted
// GameManager.upgrades object:
//   upgrades.shardShop  = { aura, maxHealth, damage }  (purchased levels)
//   upgrades.shardsSpent = ['flow-03', ...]            (ids already spent)
// Spendable shards = collectedItems minus shardsSpent. Shards are finite
// (12 in the world), so spending is a real tradeoff. No GameManager code
// changes were needed — the upgrades object is already serialized by
// GameManager.save()/load().

import GameManager from "./GameManager.js";
import "../domStuff/shardShop.css";

const MAX_LEVEL = 3;

export const SHARD_UPGRADES = {
    aura: {
        name: 'Aura',
        desc: (level) => `+${40 * level} zap radius, +${level} zap damage, faster zaps`,
        cost: (level) => level + 1, // cost of the NEXT level: 1, 2, 3 shards
    },
    maxHealth: {
        name: 'Max Health',
        desc: (level) => `+${5 * level} max HP${level > 0 ? ` (now ${25 + 5 * level})` : ''}`,
        cost: (level) => level + 1,
    },
    damage: {
        name: 'Damage',
        desc: (level) => `+${10 * level}% weapon damage`,
        cost: (level) => level + 1,
    },
    cooldown: {
        name: 'Cooldown',
        desc: (level) => `-${10 * level}% weapon cooldowns`,
        cost: (level) => level + 1,
    },
};

// Lazily initialize the shop schema on saves that predate it.
export function shardShopLevels() {
    const u = GameManager.upgrades;
    if (!u.shardShop) u.shardShop = { aura: 0, maxHealth: 0, damage: 0 };
    // Per-line guards for saves that predate a line (the Cooldown line
    // arrived with World 1).
    for (const line of Object.keys(SHARD_UPGRADES)) {
        if (u.shardShop[line] === undefined) u.shardShop[line] = 0;
    }
    if (!u.shardsSpent) u.shardsSpent = [];
    return u.shardShop;
}

export function spendableShardIds() {
    const spent = new Set(GameManager.upgrades?.shardsSpent ?? []);
    return (GameManager.collectedItems ?? []).filter((id) => !spent.has(id));
}

function applyUpgrade(line, player) {
    if (line === 'maxHealth') {
        // healthMax is derived live in Player.setStats() from
        // upgrades.shardShop.maxHealth — refresh it here and heal by the
        // gain so the purchase isn't a downgrade at low HP. Nothing is
        // stored in GameManager.stats (see resetAllUpgrades exploit fix).
        player.setStats();
        player.adjustHealth(5);
    } else if (line === 'aura') {
        // Aura radius/cooldown/damage are read live from GameManager in
        // WeaponAuraZap.setStats(); refresh the equipped instance now.
        player.aura?.setStats?.();
    }
    // 'damage' is read live via WeaponBase.shardDamageMult() — nothing to apply.
    // 'cooldown' is read live via WeaponBase.shardCooldownMult() — nothing to apply.
}

function buy(line, player) {
    const levels = shardShopLevels();
    if (levels[line] >= MAX_LEVEL) return false;
    const cost = SHARD_UPGRADES[line].cost(levels[line]);
    const pool = spendableShardIds();
    if (pool.length < cost) return false;

    GameManager.upgrades.shardsSpent.push(...pool.slice(0, cost));
    levels[line] += 1;
    applyUpgrade(line, player);
    GameManager.save();
    return true;
}

function pips(level) {
    return '●'.repeat(level) + '○'.repeat(MAX_LEVEL - level);
}

function render(player) {
    const root = document.getElementById('shard-shop');
    if (!root) return;
    const levels = shardShopLevels();
    const spendable = spendableShardIds().length;

    root.querySelector('.ss-balance').textContent = `${spendable} ◆ spendable`;
    const rows = root.querySelector('.ss-rows');
    rows.innerHTML = '';

    Object.entries(SHARD_UPGRADES).forEach(([line, def]) => {
        const level = levels[line];
        const maxed = level >= MAX_LEVEL;
        const cost = def.cost(level);
        const afford = spendable >= cost;

        const row = document.createElement('div');
        row.className = 'ss-row';

        const info = document.createElement('div');
        info.className = 'ss-info';
        const name = document.createElement('div');
        name.className = 'ss-name';
        name.innerHTML = `${def.name} <span class="ss-pips">${pips(level)}</span>`;
        const desc = document.createElement('div');
        desc.className = 'ss-desc';
        desc.textContent = def.desc(level);
        info.append(name, desc);

        const btn = document.createElement('button');
        btn.className = 'ss-buy';
        if (maxed) {
            btn.textContent = 'MAX';
            btn.disabled = true;
        } else {
            btn.textContent = `${cost} ◆`;
            btn.disabled = !afford;
            btn.onclick = () => {
                if (buy(line, player)) render(player);
            };
        }

        row.append(info, btn);
        rows.append(row);
    });
}

export function openShardShop(player) {
    let root = document.getElementById('shard-shop');
    if (root) {
        render(player);
        return;
    }

    root = document.createElement('div');
    root.id = 'shard-shop';
    root.innerHTML = `
        <div class="ss-backdrop"></div>
        <div class="ss-panel" role="dialog" aria-label="Shard shop">
            <div class="ss-head"><span>◆ SHARD SHOP</span><button class="ss-close" aria-label="Close">×</button></div>
            <div class="ss-balance"></div>
            <div class="ss-rows"></div>
            <div class="ss-note">Shards are finite — 12 in Flowline, 12 in World 1, plus boss loot. Spend wisely.</div>
        </div>`;
    document.body.appendChild(root);
    root.querySelector('.ss-close').onclick = closeShardShop;
    root.querySelector('.ss-backdrop').onclick = closeShardShop;
    // Esc closes the shop, like the inventory panel.
    document.addEventListener('keydown', escCloseShop);
    render(player);
}

function escCloseShop(e) {
    if (e.code === 'Escape') {
        // Stop the key here so it doesn't bubble up to Phaser's
        // keydown-ESC listener in EscMenu and toggle Settings too.
        e.stopPropagation();
        closeShardShop();
    }
}

export function closeShardShop() {
    document.getElementById('shard-shop')?.remove();
    document.removeEventListener('keydown', escCloseShop);
}

// The keeper: a bobbing cyan shard crystal near the devil shop in Home.
// Same interactable contract as Shop (interactGroup + isInteractable);
// F / touch Interact within 150px opens the panel.
export default class ShardShop extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene, x, y);

        scene.interactGroup.push(this);
        this.isInteractable = true;

        this.crystal = scene.add.sprite(x, y - 20, 'coin')
            .setTint(0x00ffff)
            .setScale(.5);
        scene.tweens.add({
            targets: this.crystal,
            y: y - 28,
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inout',
        });
        this.label = scene.add.text(x, y - 72, 'SHARD SHOP', {
            fontSize: '18px',
            color: '#00ffff',
        }).setOrigin(.5);

        this.collisionZone = scene.add.zone(x, y, 120, 170);
        scene.physics.add.existing(this.collisionZone, true); // true = static body
    }

    interact(player) {
        openShardShop(player);
    }
}
