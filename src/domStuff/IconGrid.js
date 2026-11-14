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
// Touch mirror of the mouse handler above: keep touches on the grid
// from reaching the game canvas, and release keyboard control.
// Note: no preventDefault() here — and none on the cards' touchstart
// either. On narrow screens #icon-grid scrolls internally (see
// index.html), and blocking the default would make that scroll
// unreachable by touch. Taps and holds still work: each card tracks its
// own gesture, and its touchend swallows the event, so a tap never
// double-fires through the synthesized mouse path.
const gridTouchStart = (e) => {
    e.stopPropagation();
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

    // Screen-reader + keyboard access: a card is interactive (tap to
    // consume, hold to lock) but a plain div, so give it button semantics
    // and a keyboard path mirroring the pointer gestures. The label states
    // the card's value and lock state, and is refreshed whenever the lock
    // flips.
    const describeCard = () => `${icon.title ?? 'Card'} card, ${icon.money ?? 1} money${icon.locked ? ', locked' : ''}`;
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('aria-label', describeCard());

    let holdTimer;
    let justUnlocked = false;

    // Touch tracking mirrors the mouse hold/tap logic below. touchstart
    // must NOT preventDefault() — that would block grid scrolling for
    // swipes starting on a card (see index.html). Instead endTouch
    // preventDefaults, so a tap never double-fires through the
    // synthesized mouse events, and a drag can't leak into mousedown /
    // mouseup and eat a card.
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
        wrapper.setAttribute('aria-label', describeCard());
    };

    const consumeCard = (fromKeyboard = false) => {
        if (icon.locked) return; // Ignore clicks on locked icons
        if (justUnlocked) {
            justUnlocked = false;
            return;
        }
        onClickHandler(icon, img);
        // Keyboard users: keep focus in the grid — move to the next card
        // so consuming doesn't drop focus to the page body.
        const nextCard = fromKeyboard ? wrapper.nextElementSibling : null;
        wrapper.remove(); // remove whole card container
        nextCard?.focus?.();
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

    // Keyboard mirror of the pointer gestures: Enter/Space consumes (like a
    // tap), L toggles the lock (like the 800ms hold). stopPropagation keeps
    // these presses from reaching the window-level chat Enter handler and
    // the game keys while a card is focused — focus owns the key, same as
    // the chat input. Key repeat is ignored: a held Enter would otherwise
    // consume card after card as focus hops to the next sibling.
    wrapper.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault(); // Space would scroll the page
            e.stopPropagation();
            consumeCard(true);
        } else if (e.code === 'KeyL') {
            e.stopPropagation();
            toggleLock();
        }
    });

    // Touch: tap to consume, press-and-hold (800ms) to lock/unlock —
    // same as mouse. Sliding the finger off cancels the hold.
    wrapper.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        // No preventDefault(): swipes starting on a card must be able to
        // scroll the grid. touch-action: manipulation on .card (see
        // index.html) already kills tap delay and double-tap zoom.
        if (e.touches.length !== 1) return; // ignore multi-touch
        touchActive = true;
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        holdTimer = setTimeout(toggleLock, 800);
    });

    wrapper.addEventListener('touchmove', (e) => {
        if (!touchActive) return;
        const t = e.touches[0];
        if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > TOUCH_SLOP_PX) {
            clearTimeout(holdTimer); // dragged off — cancel the hold
            touchActive = false;
        }
    }, { passive: true });

    const endTouch = (e) => {
        e.stopPropagation();
        // Always swallow the touchend. Without the touchstart
        // preventDefault, a drag that ends without scrolling would
        // otherwise synthesize mousedown/mouseup, and the mouseup handler
        // would consume the card.
        e.preventDefault();
        // Only a clean tap consumes: if the finger moved past the slop
        // (or it was multi-touch), touchActive is already false.
        if (!touchActive) return;
        touchActive = false;
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
