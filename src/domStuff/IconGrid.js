// iconGrid.js
let iconGrid = null;

// The DOM outlives the Phaser scenes: setupIconGrid runs on every level load
// (and on every sort/release re-render), but the #icon-grid container persists
// across all of them. Keep the container handlers in named functions and
// remove-then-add them on each setup, so re-setup replaces the old handlers
// instead of stacking duplicates — otherwise one tap would fire N stacked
// handlers after N level loads.
const gridMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Card clicks stop propagation, so the document-level chat blur never
    // fires — release keyboard control explicitly or keys stay dead.
    document.getElementById('chatInput')?.blur();
};
const gridMouseUp = (e) => {
    e.stopPropagation();
    e.preventDefault();
};
// Touch mirrors of the mouse handlers above: keep touches on the grid
// from reaching the game canvas, and release keyboard control.
const gridTouchStart = (e) => {
    e.stopPropagation();
    e.preventDefault();
    document.getElementById('chatInput')?.blur();
};
const gridTouchEnd = (e) => {
    e.stopPropagation();
    e.preventDefault();
};
const gridContainerHandlers = [
    ['mousedown', gridMouseDown],
    ['mouseup', gridMouseUp],
    ['touchstart', gridTouchStart, { passive: false }],
    ['touchend', gridTouchEnd, { passive: false }],
];

export function setupIconGrid(containerId, icons, onClickHandler) {
    const container = document.getElementById(containerId);
    iconGrid = container;
    if (!container) return console.warn(`Container ${containerId} not found`);

    for (const [type, fn, opts] of gridContainerHandlers) {
        iconGrid.removeEventListener(type, fn, opts);
        iconGrid.addEventListener(type, fn, opts);
    }

    container.innerHTML = ''; // clear existing content

    //const iconsReverse = [...icons].reverse(); // Reverse the icons array
    icons.forEach(icon => {
        addCard(icon, onClickHandler)
    });
    return container;
}
export function addCard(icon, onClickHandler) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('card');

    const img = document.createElement('img');
    img.src = icon.src;
    img.classList.add('icon');
    img.alt = icon.title ?? '';
    img.title = icon.title ?? '';
    img.money = icon.money ?? 1;
    img.style.outline = icon.locked ? '2px solid red' : ''; // Add red border if locked

    const label = document.createElement('div');
    label.classList.add('card-label');
    label.textContent = icon.money ?? '';

    let holdTimer;
    let justUnlocked = false;

    // Touch tracking mirrors the mouse hold/tap logic below. touchstart
    // preventDefault() suppresses the browser's synthesized mouse events,
    // so a tap never double-fires through both paths.
    let touchActive = false;
    let touchStartX = 0;
    let touchStartY = 0;
    const TOUCH_SLOP_PX = 12; // finger drift allowed before a hold is cancelled

    const toggleLock = () => {
        icon.locked = !icon.locked; // Lock the icon
        if (icon.locked) {
            img.style.outline = '2px solid red'; // Change border to red
        } else {
            img.style.outline = ''; // Remove border
            justUnlocked = true;
        }
    };

    const consumeCard = () => {
        if (icon.locked) return; // Ignore clicks on locked icons
        if (justUnlocked) {
            justUnlocked = false;
            return;
        }
        onClickHandler(icon, img);
        wrapper.remove(); // remove whole card container
    };

    wrapper.appendChild(img);
    wrapper.appendChild(label);
    iconGrid.appendChild(wrapper);

    let draggedCard = null;

    wrapper.addEventListener('dragstart', (e) => {
        draggedCard = wrapper;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => wrapper.style.display = 'none', 0); // hide original
    });

    wrapper.addEventListener('dragend', () => {
        draggedCard.style.display = 'block';
        draggedCard = null;
    });

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault(); // necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
    });

    // wrapper.addEventListener('drop', (e) => {
    //     e.preventDefault();
    //     console.log('card', draggedCard, 'wrapper', wrapper, wrapper.parentNode);
    //     if (draggedCard && draggedCard !== wrapper) {
    //         const parent = wrapper.parentNode;
    //         parent.insertBefore(draggedCard, wrapper);
    //     }
    // });


    wrapper.onmousedown = (e) => {
        if (e.button !== 0) return; // Only handle left mouse button
        holdTimer = setTimeout(toggleLock, 800);
    };

    wrapper.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        clearTimeout(holdTimer);
        consumeCard();
    });

    wrapper.addEventListener('mouseleave', () => {
        clearTimeout(holdTimer);
    });

    // Touch: tap to consume, press-and-hold (800ms) to lock/unlock —
    // same as mouse. Sliding the finger off cancels the hold.
    wrapper.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        e.preventDefault(); // no synthetic mouse events, no scroll/zoom gestures
        if (e.touches.length !== 1) return; // ignore multi-touch
        touchActive = true;
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        holdTimer = setTimeout(toggleLock, 800);
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e) => {
        if (!touchActive) return;
        const t = e.touches[0];
        if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > TOUCH_SLOP_PX) {
            clearTimeout(holdTimer); // dragged off — cancel the hold
            touchActive = false;
        }
    }, { passive: true });

    const endTouch = (e) => {
        if (!touchActive) return;
        touchActive = false;
        e.stopPropagation();
        e.preventDefault();
        clearTimeout(holdTimer);
        consumeCard();
    };
    wrapper.addEventListener('touchend', endTouch, { passive: false });
    wrapper.addEventListener('touchcancel', () => {
        touchActive = false;
        clearTimeout(holdTimer);
    });

}



export function setupReleaseButton(onClickHandler) {
    return setupToolbarButton('clear-cards-btn', onClickHandler);
}

export function setupSortButton(onClickHandler) {
    return setupToolbarButton('sortCards-btn', onClickHandler);
}

// Shared wiring for the two persistent card-toolbar buttons. This runs on
// every level load and every sort/release re-render, while the buttons
// persist in the DOM — so it removes the previously wired pair before
// attaching the new one (replace, don't stack); the handlers stay fresh
// because they close over the current level scene.
function setupToolbarButton(buttonId, onClickHandler) {
    const button = document.getElementById(buttonId);
    button._conduitHandlers?.forEach(([type, fn, opts]) => button.removeEventListener(type, fn, opts));

    const onMouseDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        button.blur();
        document.getElementById('chatInput')?.blur();
        onClickHandler();
    };
    // Touch mirror of the mousedown handler above (same pattern as the card
    // grid and settings buttons): preventDefault suppresses the browser's
    // synthesized mouse events, so a tap fires the handler once, with no tap
    // delay or scroll/zoom gesture. Desktop mouse behavior unchanged.
    const onTouchStart = (e) => {
        e.stopPropagation();
        e.preventDefault();
        button.blur();
        document.getElementById('chatInput')?.blur();
        onClickHandler();
    };
    button._conduitHandlers = [
        ['mousedown', onMouseDown],
        ['touchstart', onTouchStart, { passive: false }],
    ];
    button._conduitHandlers.forEach(([type, fn, opts]) => button.addEventListener(type, fn, opts));
    return button;
}
