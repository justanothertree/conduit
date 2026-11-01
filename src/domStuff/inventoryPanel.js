// inventoryPanel.js — responsive DOM inventory panel.
//
// Replaces the old Phaser-canvas inventory (which needed camera zoom hacks
// on phones). DOM, not canvas, so taps land reliably: z-index 20, above
// the touch overlay (z-index 10), max-width min(480px, 94vw), 44px+ tap
// targets. Same pattern as #shard-shop.
//
// The Inventory Phaser scene (src/scenes/Inventory.js) owns the lifecycle:
// it calls openInventoryPanel(this) / closeInventoryPanel(), and the panel
// calls back into the scene for purchaseUpgrade / resetAllUpgrades /
// equipWeapon so all game logic stays in one place.
//
// Mobile differences from desktop:
// - No hover: talents use tap-to-inspect (first tap shows desc + cost,
//   second tap or Buy button confirms the purchase).
// - No right-click: each weapon has explicit Slot 1 / Slot 2 buttons.

import GameManager from "../things/GameManager.js";
import { weaponUpgrades } from "../weapons/WeaponManager.js";
import "./inventoryPanel.css";

const WEAPONS = [
    { key: 'shurikan', label: 'Shurikan' },
    { key: 'sword', label: 'Sword' },
    { key: 'darkorb', label: 'Dark Orb' },
    { key: 'whip', label: 'Whip' },
];

export function isInventoryPanelOpen() {
    return !!document.getElementById('inventory-panel');
}

export function openInventoryPanel(invScene) {
    if (isInventoryPanelOpen()) {
        render(invScene);
        return;
    }

    const root = document.createElement('div');
    root.id = 'inventory-panel';
    root.innerHTML = `
        <div class="inv-backdrop"></div>
        <div class="inv-panel" role="dialog" aria-label="Inventory">
            <div class="inv-head">
                <span>🎒 INVENTORY</span>
                <button class="inv-close" aria-label="Close">×</button>
            </div>
            <div class="inv-sub"></div>
            <div class="inv-section-title">Weapons</div>
            <div class="inv-weapons"></div>
            <div class="inv-section-title">Source Talents</div>
            <div class="inv-talents"></div>
            <button class="inv-reset">Reset all power<br><span style="font-size:12px;font-weight:normal">Half of Source spent refunded</span></button>
            <div class="inv-note">Tap a talent to inspect it, then Buy. Shard Shop upgrades are never reset.</div>
        </div>`;
    document.body.appendChild(root);

    root.querySelector('.inv-backdrop').addEventListener('click', () => invScene.closePanel());
    root.querySelector('.inv-close').addEventListener('click', () => invScene.closePanel());
    root.querySelector('.inv-reset').addEventListener('click', () => {
        invScene.resetAllUpgrades();
        render(invScene);
    });

    render(invScene);
}

export function closeInventoryPanel() {
    document.getElementById('inventory-panel')?.remove();
}

function costText(upgrade) {
    const c = typeof upgrade.cost === 'function' ? upgrade.cost() : upgrade.cost;
    return typeof c === 'number' ? `${c} Source` : `${c}`;
}

function rankText(upgrade) {
    const cur = GameManager.upgrades[upgrade.id] ?? 0;
    if (upgrade.maxRank < 0) return `Lv ${cur}`; // infinite (aura level)
    return `${cur}/${upgrade.maxRank}`;
}

function render(invScene) {
    const root = document.getElementById('inventory-panel');
    if (!root || !invScene.player) return;
    const player = invScene.player;

    // Header: money + damage scaling
    const sub = root.querySelector('.inv-sub');
    const scaling = player.leftWeapon?.damageScaling?.()?.toFixed(2) ?? '?';
    sub.innerHTML = `<span class="inv-money">${GameManager.power.money}</span> Source &nbsp;•&nbsp; Damage ×<span class="inv-money">${scaling}</span>`;

    // Weapons with Slot 1 / Slot 2 buttons
    const weaponsEl = root.querySelector('.inv-weapons');
    weaponsEl.innerHTML = '';
    const leftName = GameManager.weapons?.left;
    const rightName = GameManager.weapons?.right;
    WEAPONS.forEach(({ key, label }) => {
        const row = document.createElement('div');
        row.className = 'inv-weapon';

        const name = document.createElement('div');
        name.className = 'inv-weapon-name';
        let equipped = '';
        if (leftName === key) equipped += ' <span class="inv-weapon-equipped">[Slot 1]</span>';
        if (rightName === key) equipped += ' <span class="inv-weapon-equipped">[Slot 2]</span>';
        name.innerHTML = `${label}${equipped}`;
        row.appendChild(name);

        const btn1 = document.createElement('button');
        btn1.className = 'inv-slot-btn' + (leftName === key ? ' active' : '');
        btn1.textContent = 'Slot 1';
        btn1.addEventListener('click', () => {
            player.equipWeapon(key, 0);
            invScene.sound?.play('clinksound2');
            render(invScene);
        });
        const btn2 = document.createElement('button');
        btn2.className = 'inv-slot-btn' + (rightName === key ? ' active' : '');
        btn2.textContent = 'Slot 2';
        btn2.addEventListener('click', () => {
            player.equipWeapon(key, 1);
            invScene.sound?.play('clinksound2');
            render(invScene);
        });
        row.append(btn1, btn2);
        weaponsEl.appendChild(row);
    });

    // Talents: tap-to-inspect, then Buy
    const talentsEl = root.querySelector('.inv-talents');
    talentsEl.innerHTML = '';

    // IDs disabled by a maxed either/or choice (e.g. auraUpgradeA1 maxed
    // disables auraUpgradeA2) — dimmed, not purchasable.
    const disabledIds = new Set();
    weaponUpgrades.forEach((u) => {
        const c = GameManager.upgrades[u.id] ?? 0;
        if (u.maxRank >= 0 && c >= u.maxRank && u.disables) {
            u.disables.forEach((id) => disabledIds.add(id));
        }
    });

    const talentEls = {};
    weaponUpgrades.forEach((upgrade) => {
        const cur = GameManager.upgrades[upgrade.id] ?? 0;
        const maxed = upgrade.maxRank >= 0 && cur >= upgrade.maxRank;
        const disabled = disabledIds.has(upgrade.id);

        const el = document.createElement('div');
        el.className = 'inv-talent' + (maxed ? ' maxed' : '');
        if (disabled) el.style.opacity = '0.4';
        if (invScene._selectedTalent === upgrade.id) el.classList.add('selected');
        talentEls[upgrade.id] = el;

        const nameRow = document.createElement('div');
        nameRow.className = 'inv-talent-name';
        const label = document.createElement('span');
        label.textContent = upgrade.tooltip || upgrade.id;
        const pips = document.createElement('span');
        pips.className = 'inv-talent-pips';
        pips.textContent = maxed ? 'MAX' : rankText(upgrade);
        nameRow.append(label, pips);
        el.appendChild(nameRow);

        // Tap to inspect (no hover on mobile). Disabled talents can't be
        // selected.
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('inv-buy')) return;
            if (disabled) return;
            invScene._selectedTalent = invScene._selectedTalent === upgrade.id ? null : upgrade.id;
            render(invScene);
        });

        if (invScene._selectedTalent === upgrade.id && !maxed && !disabled) {
            const detail = document.createElement('div');
            detail.className = 'inv-talent-detail';
            const realCost = typeof upgrade.cost === 'function' ? upgrade.cost() : upgrade.cost;
            const afford = typeof realCost === 'number' ? GameManager.power.money >= realCost : true;
            detail.innerHTML = `<span class="inv-cost">Cost: ${costText(upgrade)}</span>`;
            const buy = document.createElement('button');
            buy.className = 'inv-buy';
            buy.textContent = afford ? `Buy — ${costText(upgrade)}` : 'Not enough Source';
            buy.disabled = !afford;
            buy.addEventListener('click', (e) => {
                e.stopPropagation();
                if (invScene.purchaseUpgrade(upgrade)) {
                    invScene._selectedTalent = null;
                }
                render(invScene);
            });
            detail.appendChild(document.createElement('br'));
            detail.appendChild(buy);
            el.appendChild(detail);
        }

        talentsEl.appendChild(el);
    });
}

// Re-render when money changes (e.g. buying a talent updates the header).
export function refreshInventoryPanel(invScene) {
    if (isInventoryPanelOpen()) render(invScene);
}
