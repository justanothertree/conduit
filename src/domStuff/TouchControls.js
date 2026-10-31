// TouchControls.js — phone-first touch scheme for Conduit.
//
// Replaces the keyboard-mirroring key bar on touch devices. Desktop is
// untouched: the kb-grid stays as-is and these controls are never built.
//
// Input bridge: the joystick and buttons drive the SAME
// document.*Button.isClicked flags that playerGetInput() already reads,
// and the menu reuses the existing keyboard handlers by emitting on the
// scenes' keyboard plugins. No movement/physics code is touched.

import './touchControls.css';
import { computeJoystickInput } from './touchAim.js';

const SETTINGS_KEY = 'conduitTouchSettings';
const DEFAULTS = { size: 1, opacity: 0.75, leftHanded: false };

export function isTouchDevice() {
    return window.matchMedia('(pointer: coarse)').matches;
}

function loadSettings() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

function saveSettings(s) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch { /* private mode etc. — controls still work */ }
}

const buzz = (ms = 8) => {
    try { navigator.vibrate?.(ms); } catch { /* no haptics */ }
};

const gameScene = () => document.activeGameScene || null;
const emitGameKey = (code) => gameScene()?.input?.keyboard?.emit(code);

function setMoveFlags({ left, right, crouch }) {
    if (document.leftButton) document.leftButton.isClicked = left;
    if (document.rightButton) document.rightButton.isClicked = right;
    if (document.crouchButton) document.crouchButton.isClicked = crouch;
}

function clearMoveFlags() {
    setMoveFlags({ left: false, right: false, crouch: false });
}

export function setupTouchControls() {
    const settings = loadSettings();

    // Attack flag read by Player (document.attackButton?.isClicked).
    document.attackButton = document.attackButton || { isClicked: false };

    const root = document.createElement('div');
    root.id = 'touch-controls';
    document.body.appendChild(root);

    const applySettings = () => {
        root.style.setProperty('--tc-scale', settings.size);
        root.style.setProperty('--tc-opacity', settings.opacity);
        root.classList.toggle('left-handed', settings.leftHanded);
        saveSettings(settings);
    };

    // ---------------------------------------------------------- joystick
    const zone = document.createElement('div');
    zone.id = 'tc-joystick-zone';
    root.appendChild(zone);

    const base = document.createElement('div');
    base.id = 'tc-stick-base';
    const knob = document.createElement('div');
    knob.id = 'tc-stick-knob';
    base.appendChild(knob);
    root.appendChild(base);

    let stickTouchId = null;
    let originX = 0, originY = 0;
    const stickRadius = () => 60 * settings.size;

    const moveKnob = (dx, dy) => {
        const r = stickRadius();
        const dist = Math.hypot(dx, dy);
        const cl = dist > r ? r / dist : 1;
        knob.style.transform = `translate(${dx * cl}px, ${dy * cl}px)`;
    };

    zone.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (stickTouchId !== null) return;
        const t = e.changedTouches[0];
        stickTouchId = t.identifier;
        originX = t.clientX;
        originY = t.clientY;
        base.style.left = `${originX}px`;
        base.style.top = `${originY}px`;
        base.style.display = 'block';
        knob.style.transform = 'translate(0px, 0px)';
        buzz();
    }, { passive: false });

    const stickMove = (e) => {
        if (stickTouchId === null) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== stickTouchId) continue;
            const dx = t.clientX - originX;
            const dy = t.clientY - originY;
            moveKnob(dx, dy);
            setMoveFlags(computeJoystickInput(dx, dy, stickRadius()));
        }
    };
    const stickEnd = (e) => {
        if (stickTouchId === null) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== stickTouchId) continue;
            stickTouchId = null;
            base.style.display = 'none';
            clearMoveFlags();
        }
    };
    zone.addEventListener('touchmove', (e) => { e.preventDefault(); stickMove(e); }, { passive: false });
    zone.addEventListener('touchend', stickEnd);
    zone.addEventListener('touchcancel', stickEnd);

    // ----------------------------------------------------- action buttons
    const actions = document.createElement('div');
    actions.id = 'tc-actions';
    root.appendChild(actions);

    // Press-and-hold button driving a document flag; multi-touch safe.
    function holdButton(label, cls, flag, extraDown, extraUp) {
        const btn = document.createElement('div');
        btn.className = `tc-btn ${cls}`;
        btn.innerHTML = `<span>${label}</span>`;
        const touches = new Set();
        btn.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            for (const t of e.changedTouches) touches.add(t.identifier);
            if (flag) flag.isClicked = true;
            btn.classList.add('pressed');
            buzz();
            extraDown?.();
        }, { passive: false });
        const release = (e) => {
            for (const t of e.changedTouches) touches.delete(t.identifier);
            if (touches.size === 0) {
                if (flag) flag.isClicked = false;
                btn.classList.remove('pressed');
                extraUp?.();
            }
        };
        btn.addEventListener('touchend', release);
        btn.addEventListener('touchcancel', release);
        actions.appendChild(btn);
        return btn;
    }

    const releaseAttack = () => {
        try { gameScene()?.player?.leftWeapon?.release(); } catch { /* no player yet */ }
    };

    holdButton('JUMP', 'tc-jump', document.jumpButton);
    holdButton('DASH', 'tc-dash', document.dashButton);
    holdButton('ATK', 'tc-attack', document.attackButton, null, releaseAttack);

    // ------------------------------------------------------- pause + menu
    const pauseBtn = document.createElement('div');
    pauseBtn.id = 'tc-pause';
    pauseBtn.innerHTML = '<span>II</span>';
    root.appendChild(pauseBtn);

    const menu = document.createElement('div');
    menu.id = 'tc-menu';
    menu.innerHTML = '<div class="tc-menu-title">MENU</div>';
    root.appendChild(menu);
    let menuOpen = false;

    const toggleMenu = (open) => {
        menuOpen = open ?? !menuOpen;
        menu.classList.toggle('open', menuOpen);
        pauseBtn.classList.toggle('active', menuOpen);
        buzz();
    };
    pauseBtn.addEventListener('touchstart', (e) => {
        e.stopPropagation(); e.preventDefault(); toggleMenu();
    }, { passive: false });

    function menuButton(label, onTap, hold) {
        const btn = document.createElement('div');
        btn.className = 'tc-menu-btn';
        btn.textContent = label;
        if (hold) {
            const touches = new Set();
            btn.addEventListener('touchstart', (e) => {
                e.stopPropagation(); e.preventDefault();
                for (const t of e.changedTouches) touches.add(t.identifier);
                btn.classList.add('pressed');
                onTap(true); buzz();
            }, { passive: false });
            const release = (e) => {
                for (const t of e.changedTouches) touches.delete(t.identifier);
                if (touches.size === 0) { btn.classList.remove('pressed'); onTap(false); }
            };
            btn.addEventListener('touchend', release);
            btn.addEventListener('touchcancel', release);
        } else {
            btn.addEventListener('touchstart', (e) => {
                e.stopPropagation(); e.preventDefault(); buzz(); onTap();
                toggleMenu(false);
            }, { passive: false });
        }
        menu.appendChild(btn);
        return btn;
    }

    // Heal reuses the existing hold-to-heal flag.
    menuButton('Heal', (down) => {
        if (document.healButton) document.healButton.isClicked = down;
    }, true);
    menuButton('Interact', () => emitGameKey('keydown-F'));
    menuButton('Inventory', () => {
        const gs = gameScene();
        if (!gs) return;
        if (gs.invMenu?.scene.isVisible()) gs.input.keyboard.emit('keyup-C');
        else gs.input.keyboard.emit('keydown-C');
    });
    menuButton('Home', () => emitGameKey('keydown-T'));
    menuButton('Respawn', () => emitGameKey('keydown-R'));
    menuButton('Settings', () => {
        gameScene()?.scene.get('EscMenu')?.input.keyboard.emit('keydown-ESC');
    });
    menuButton('Spectate', () => emitGameKey('keydown-RIGHT'));
    menuButton('Chat', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
    });

    // ------------------------------------------------- touch settings
    const settingsTitle = document.createElement('div');
    settingsTitle.className = 'tc-menu-title';
    settingsTitle.textContent = 'TOUCH';
    menu.appendChild(settingsTitle);

    function settingRow(label, input) {
        const row = document.createElement('label');
        row.className = 'tc-setting-row';
        row.innerHTML = `<span>${label}</span>`;
        row.appendChild(input);
        // Don't let row taps close the menu or buzz like buttons.
        row.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        menu.appendChild(row);
        return row;
    }

    const sizeInput = document.createElement('input');
    sizeInput.type = 'range'; sizeInput.min = '0.8'; sizeInput.max = '1.3';
    sizeInput.step = '0.05'; sizeInput.value = settings.size;
    sizeInput.addEventListener('input', () => {
        settings.size = parseFloat(sizeInput.value); applySettings();
    });
    settingRow('Size', sizeInput);

    const opacityInput = document.createElement('input');
    opacityInput.type = 'range'; opacityInput.min = '0.3'; opacityInput.max = '1';
    opacityInput.step = '0.05'; opacityInput.value = settings.opacity;
    opacityInput.addEventListener('input', () => {
        settings.opacity = parseFloat(opacityInput.value); applySettings();
    });
    settingRow('Opacity', opacityInput);

    const handInput = document.createElement('input');
    handInput.type = 'checkbox'; handInput.checked = settings.leftHanded;
    handInput.addEventListener('change', () => {
        settings.leftHanded = handInput.checked; applySettings();
    });
    settingRow('Left-handed', handInput);

    // Tapping outside the menu closes it.
    root.addEventListener('touchstart', (e) => {
        if (menuOpen && !menu.contains(e.target) && e.target !== pauseBtn && !pauseBtn.contains(e.target)) {
            toggleMenu(false);
        }
    }, { passive: true });

    applySettings();
    return { root, settings, applySettings };
}
