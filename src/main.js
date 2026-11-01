import Phaser from 'phaser';
import Boot from './scenes/Boot.js';
import Preloader from './scenes/Preloader.js';
import EscMenu from './scenes/EscMenu.js';
import Inventory from './scenes/Inventory.js';
import PlayerUI from './scenes/playerUI.js';
import './domStuff/Style.css';
import Home from './scenes/Home.js';
import Level1 from './scenes/Level1.js';
import Level2 from './scenes/Level2.js';
import Level3 from './scenes/Level3.js';
import Level4 from './scenes/Level4.js';
import Level5 from './scenes/Level5.js';
import Level6 from './scenes/Level6.js';
import LevelYaya1 from './scenes/LevelYaya1.js';
import LevelFlow from './scenes/LevelFlow.js';
import Level7 from './scenes/Level7.js';
import Level8 from './scenes/Level8.js';
import setupChat from './domStuff/Chat.js';

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 720, x: 0 },
      timescale: 1,
      // fps: 60,
      // fixedStep: true,
      tileBias: 55,
      debug: false,
    }
  },
  parent: 'conduit-game',
  input: {
    mouse: {
      wheel: true,
      preventDefaultWheel: false,
    }
  },
  dom: {
    createContainer: true,
  },

  scene: [Boot, Preloader, Home,
    Level1, Level2, Level3, Level4, Level5, Level6, Level7, Level8,
    LevelYaya1, LevelFlow,
    PlayerUI, Inventory, EscMenu],
};

let game = new Phaser.Game(config);

const resizeGame = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  game.scale.resize(width, height);
};

resizeGame(); // Initial call just in case

// A. Use ResizeObserver for layout-triggered changes
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(() => {
    resizeGame();
  });
  ro.observe(document.body);
}

// B. Fallback: also monitor window resize (catches maximize/minimize)
window.addEventListener('resize', () => {
  setTimeout(resizeGame, 50); // delay helps when toggling F12
});

window.addEventListener('keydown', function (e) {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault(); // Prevent page from scrolling
  }
});

// TEMPORARY DIAGNOSTIC (2026-11-01): on-screen error overlay to catch the
// LevelFlow soft-lock. Remove once diagnosed.
window.addEventListener('error', (e) => {
  const div = document.getElementById('err-overlay') || (() => {
    const d = document.createElement('div');
    d.id = 'err-overlay';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#a00;color:#fff;font:14px monospace;padding:10px;white-space:pre-wrap;max-height:50vh;overflow:auto;';
    document.body.appendChild(d);
    return d;
  })();
  div.textContent += e.message + '\n' + (e.error?.stack || '') + '\n---\n';
});

// Pinch-zoom breaks the fixed-position touch UI, so it's killed here.
// iOS Safari ignores user-scalable=no in the viewport meta — the
// gesturestart/gesturechange prevention is what actually stops it there.
// Trackpad pinch-zoom on desktop arrives as ctrl+wheel.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

setupChat();