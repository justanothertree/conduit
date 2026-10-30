import './keyBindsStyle.css';

let kbGrid = null;
let hidden = false;

export function setupKeybindWindow() {
    const section = document.getElementById('kb-section');

    kbGrid = document.createElement('div');
    kbGrid.className = 'kb-grid';
    kbGrid.id = 'keyboard-grid'; // targeted by the safe-area rule in index.html

    kbGrid.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
    })

    // Touch mirror of the mousedown handler above: taps landing on the gaps
    // between buttons behave exactly like desktop clicks — stopPropagation
    // keeps them from reaching the document-level chat blur, and
    // preventDefault suppresses the browser's synthesized mouse events.
    kbGrid.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault();
    }, { passive: false })

    section.appendChild(kbGrid);

    const hideUI = () => {
        if (hidden) {
            kbGrid.style.display = 'grid';
        } else {
            kbGrid.style.display = 'none';
        }
        hidden = !hidden;
    }
    addButton('KeyUnpressed', 'Slash', 'Hide', 2, 11, undefined, '/', hideUI);
}

export function addButton(imgSrc, key, action = 'Interact', row = 1, col = 1, wid = '60px', labelOverride, callback) {
    const button = document.createElement('div');
    button.className = 'kb-button';
    button.style.width = wid;
    button.dataset.action = action;

    button.style.gridRow = row;
    button.style.gridColumn = col;

    const img = document.createElement('img');
    img.className = 'kb-image';
    img.src = `assets/${imgSrc}.png`;

    const label = document.createElement('div');
    label.className = 'kb-label';
    if (labelOverride) {
        label.textContent = labelOverride;
    } else {
        label.textContent = key.replace('Key', '');
    }

    const info = document.createElement('div');
    info.className = 'kb-info';
    info.textContent = action;

    button.appendChild(img);
    button.appendChild(label);
    button.appendChild(info);
    kbGrid.appendChild(button);

    let activeButton = null;
    const active = () => {
        activeButton = { img, label };
        img.src = 'assets/KeyPressed.png';
        label.style.transform = 'translate(-50%, -60%)';
        button.isClicked = true;
        callback?.();
    }
    const inActive = () => {
        if (activeButton) {
            activeButton.img.src = 'assets/KeyUnpressed.png';
            activeButton.label.style.transform = 'translate(-50%, -95%)';
            button.isClicked = false;
            activeButton = null;
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.code === key) {
            active?.();
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === key) {
            inActive?.();
        }
    });

    button.addEventListener('mousedown', (e) => {
        active?.();
    });
    window.addEventListener('mouseup', (e) => {
        inActive?.();
    });

    // --- Touch support (multi-touch): each finger tracked by identifier so
    // holding Left with one thumb while tapping Jump with another works.
    const activeTouches = new Set();
    button.addEventListener('touchstart', (e) => {
        e.preventDefault(); // suppress compat mouse events + scroll/zoom
        for (const t of e.changedTouches) activeTouches.add(t.identifier);
        active?.();
    }, { passive: false });
    const releaseTouch = (e) => {
        for (const t of e.changedTouches) activeTouches.delete(t.identifier);
        if (activeTouches.size === 0) inActive?.();
    };
    button.addEventListener('touchend', releaseTouch);
    button.addEventListener('touchcancel', releaseTouch);

    return button;
}

export function addSettingsButton(callbackActive, callbackInActive, texture = 'SettingsButton', col = 13, row = 2) {
    const button = document.createElement('div');
    button.className = 'kb-button';

    button.style.gridRow = row;
    button.style.gridColumn = col;

    const img = document.createElement('img');
    img.className = 'kb-settingsimage';
    img.src = 'assets/' + texture + '.png';

    button.appendChild(img);
    kbGrid.appendChild(button);

    button.dataset.action = texture;

    const active = () => {
        img.src = 'assets/' + texture + 'Press' + '.png';
        callbackActive?.();
    }

    const inActive = () => {
        img.src = 'assets/' + texture + '.png';
        callbackInActive?.();
    }

    button.addEventListener('mousedown', (e) => {
        active();
    })
    button.addEventListener('mouseup', (e) => {
        inActive();
    })

    // Touch mirrors of the mouse handlers above (same pattern as addButton):
    // preventDefault suppresses the browser's synthesized mouse events, so a
    // tap fires the callback once, with no tap delay or scroll/zoom gesture.
    button.addEventListener('touchstart', (e) => {
        e.preventDefault();
        active();
    }, { passive: false });
    const releaseTouch = (e) => {
        e.preventDefault();
        inActive();
    };
    button.addEventListener('touchend', releaseTouch, { passive: false });
    button.addEventListener('touchcancel', releaseTouch, { passive: false });

    return button;
}