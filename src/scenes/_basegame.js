import Player from '../things/Player.js';
import NetworkManager from '../things/NetworkManager.js';
import GameManager from '../things/GameManager.js';
import SpawnManager from '../things/_spawnmanager.js';
import { TimeTrialRecorder, TimeTrialGhost, bestRunForStart, startKeyFor, TRIAL_MAX_STARTS } from '../things/timeTrialGhost.js';
import WeaponGroup from '../weapons/WeaponGroup.js';
import SoundUtil from '../things/soundUtils.js';
import ScoreBoard from '../things/scoreBoard.js';
import { setupIconGrid, setupReleaseButton, setupSortButton } from '../domStuff/IconGrid.js';
import setupChat, { chatNetwork, setScene } from '../domStuff/Chat.js';
import { addSettingsButton } from '../domStuff/KeyBinds.js';

export default class BaseGame extends Phaser.Scene {
  constructor(key) {
    super(key);
    this.key = key;
  }

  // Time-trial ghost (see things/timeTrialGhost.js): off by default;
  // timed levels (LevelFlow, World1) opt in. The ghost is a local
  // personal-best replay — no server, no multiplayer.
  trialEnabled = false;

  preload() {
    this.loadingBar();
  }

  update(time, delta) {
    if (this.player && this.playerSpawned) this.player.handleInput(time, delta);
    // Record the run at 10Hz while the race clock is running. Cheap:
    // a few arithmetic ops + one array push per sample boundary.
    if (this.trialRecording && !this.trialFinished && this.raceTimer
      && typeof this.raceTime === 'number' && this.player) {
      this.trialRecording.sample(this.raceTime);
    }
  }
  setupWorld(xleft = 0, ytop = 0, width = 6400, height = 12800) {
    GameManager.load();
    this.physics.world.setBounds(xleft, ytop, width, height);
    this.bounds = this.physics.world.bounds;
    this.cameras.main.setBounds(xleft, ytop, width, height);

    this.network = new NetworkManager(this);
    this.spawnManager = new SpawnManager(this);

    // The touch menu is DOM-side and needs the current game scene to reach
    // the scenes' keyboard plugins (menu actions emit the same key events
    // the desktop keys fire). Replace-not-stack: cleared on shutdown.
    document.activeGameScene = this;
    this.events.once('shutdown', () => {
        if (document.activeGameScene === this) document.activeGameScene = null;
    });

    const joinVoiceChat = () => {
      if (!this.network.voiceChat.audioContext) {
        this.network.voiceChat._initMic();
      }
    }
    // The DOM button bar is global and outlives levels, but setupWorld runs on
    // every level load — replace (not stack) the per-level voice/debug
    // buttons. Their callbacks close over the current scene, so they can't be
    // created just once; removing the previous pair first keeps buttons and
    // their listeners from piling up unboundedly. (Same convention as the
    // Preloader's document.*Button refs.)
    document.voiceButton?.remove();
    document.debugButton?.remove();
    document.voiceButton = addSettingsButton(joinVoiceChat, null, 'VoiceButton', 15);
    document.debugButton = addSettingsButton(()=> {
      console.log(this.game.scene.getScenes())
    }, undefined, undefined, 17, 2)


    // The window 'beforeunload' listener is global, but setupWorld runs on
    // every level load — without removal the save-on-exit handlers would
    // stack, firing (and saving) N times on tab close after N level visits.
    // Register with a named handler and remove it when the scene shuts down,
    // the same replace-not-stack convention as the other per-level listeners
    // (Day 14/16/19). Phaser emits 'shutdown' on scene.start transitions.
    const saveOnUnload = () => {
      GameManager.area = this.key;
      GameManager.location.x = this.player.x;
      GameManager.location.y = this.player.y;
      GameManager.useLastLocation = true;
      GameManager.save();
    };
    window.addEventListener('beforeunload', saveOnUnload);
    this.events.once('shutdown', () => {
      window.removeEventListener('beforeunload', saveOnUnload);
    });

    this.events.once('shutdown', () => {
      this.cleanupScene();
    }, this);
    this.events.once('destroy', () => {
      this.cleanupScene();
    }, this);
  }

  setupNet() {

    this.network.refreshScene(this);
    // Level entry re-syncs with the new scene key (the Player
    // constructor already fired one sync, but it is 500ms-throttled,
    // so this is a no-op when that one just went out — and it covers
    // a refresh without a fresh Player). The scene field is what
    // re-elects the host for this level.
    this.player?.syncNetwork();
    chatNetwork();
    setScene(this);
  }

  setupSky({ sky1 = 'purplesky0', sky2 = true, sky3 = true } = {}) {
    this.sky1 = this.add.image(this.scale.width / 2, this.scale.height / 2, sky1)
      .setOrigin(.5).setDisplaySize(this.scale.width, this.scale.height).setScrollFactor(0);

    if (sky2) this.sky2 = this.add.image(1000, 1200, 'purplesky1').setScale(1).setScrollFactor(.2).setOrigin(.5, .5);
    if (sky3) this.sky3 = this.add.image(2400, 2000, 'purplesky2').setScale(1).setScrollFactor(.6).setOrigin(.5, .5);

    // setupSky runs on every level load but the ScaleManager is global, so a
    // plain .on() would stack one resizeSky per visited level — dead scenes'
    // handlers would keep firing on every window resize, touching destroyed
    // images. Replace (not stack), same as the DOM handlers in IconGrid.
    this.scale.off('resize', this.resizeSky, this);
    this.scale.on('resize', this.resizeSky, this);
  }

  resizeSky(gameSize) {
    const width = gameSize.width;
    const height = gameSize.height;
    this.sky1.setPosition(width / 2, height / 2);
    this.sky1.setDisplaySize(this.scale.width, this.scale.height);
  }

  setupCards() {
    const clickIcon = (icon, imgElement) => {
      if (icon.locked) return;
      this.player.updateMoney(icon.money);

      // Remove the clicked card by index
      const index = GameManager.cards.indexOf(icon);
      if (index !== -1) {
        GameManager.cards.splice(index, 1);
        GameManager.save();
      }
    };


    const icons = GameManager.cards;

    //phaser making the icongrid
    this.iconGrid = setupIconGrid('icon-grid', icons, clickIcon, this);

  }


  setupPlayer(x = 111, y = 111) {
    const locationX = GameManager.useLastLocation ? GameManager.location.x : x;
    const locationY = GameManager.useLastLocation ? GameManager.location.y : y;

    this.player = new Player(this, locationX, locationY);
    if (this.spawnManager) {
      this.spawnManager.player = this.player;
    }
    if (GameManager.useLastLocation) {
      this.playerSpawned = true;
    }
    this.cameras.main.startFollow(this.player, false, .05, .05);

    this.cardSetupTimer = null;
    this.setupCards();
    const releaseUnlockedCards = () => {
      const unlockedCards = GameManager.cards.filter(icon => !icon.locked);
      let totalMoney = 0;
      unlockedCards.forEach(icon => {
        totalMoney += icon.money;
      });
      this.player.updateMoney(totalMoney);
      // Remove all unlocked cards
      GameManager.cards = GameManager.cards.filter(icon => icon.locked);
      GameManager.save();
      this.setupCards(); // Refresh the icon grid
    }
    this.releaseButton = setupReleaseButton(releaseUnlockedCards);

    const sortCards = () => {
      GameManager.cards.sort((a, b) => b.money - a.money);
      this.setupCards(); // Refresh the icon grid
    };
    this.sortButton = setupSortButton(sortCards);


    if (this.network.voiceChat) {
      this.network.voiceChat.setPlayerGetter(() => {
        return { x: this.player.x, y: this.player.y };
      });
    }


    if (!this.scene.isActive('Inventory')) {
      this.scene.launch('Inventory', { player: this.player });
      this.invMenu = this.scene.get('Inventory');
    } else {
      this.invMenu = this.scene.get('Inventory');
      this.invMenu.init({ player: this.player });
    }

    // Inventory is a DOM panel now (see Inventory.js). Toggle via its
    // controller; never scene.setActive(false) — deactivating makes the
    // isActive check above re-run create() without shutdown on the next
    // respawn/portal, stacking keyboard listeners.
    const openInv = () => {
      this.invMenu.openPanel();
    }

    const closeInv = () => {
      this.invMenu.closePanel();
    }
    this.input.keyboard.on('keydown-C', (e) => {
      // Ignore key repeat: holding C re-fires keydown ~30x/sec and each
      // one re-opens/re-renders the DOM panel, making it unusable.
      // Undefined-safe: some menu paths emit without an event object.
      if (e?.repeat) return;
      openInv?.();
    });
    this.input.keyboard.on('keyup-C', () => {
      closeInv?.();
    });

    if (!this.scene.isActive('PlayerUI')) {
      this.scene.launch('PlayerUI', { player: this.player, gameScene: this });
      this.playerUI = this.scene.get('PlayerUI');
    } else {
      this.playerUI = this.scene.get('PlayerUI');
      this.playerUI.init({ player: this.player, gameScene: this });
    }
    if (!this.scene.isActive('EscMenu')) {
      this.scene.launch('EscMenu', { gameScene: this, playerUI: this.playerUI });
      this.escMenu = this.scene.get('EscMenu');
    } else {
      this.escMenu = this.scene.get('EscMenu');
      this.escMenu.init({ gameScene: this, playerUI: this.playerUI })
    }
  }

  spawnPlayer(x, y) {
    if (!GameManager.useLastLocation) {
      this.setupRaceTimer();
      this.cameras.main.startFollow(this.player, false, 1, 1);
      this.player.setPosition(x, y);
      this.cameras.main.startFollow(this.player, false, .05, .05);
      GameManager.location.x = x;
      GameManager.location.y = y;
      GameManager.useLastLocation = true;
      this.playerSpawned = true;
    }
  }

  setupTileMap(tilemap = 'tilemap1', tilesheet = 'tilesheet') {
    if (this.tilemap) return;
    this.tilemap = this.make.tilemap({ key: tilemap });
    this.tileset = this.tilemap.addTilesetImage(tilesheet, tilesheet);
    this.layer1 = this.tilemap.createLayer('layer1', this.tileset, 0, 0);
    this.walls = this.tilemap.createLayer('walls', this.tileset, 0, 0);
    this.layer2 = this.tilemap.createLayer('layer2', this.tileset, 0, 0);
    this.walls2 = this.tilemap.createLayer('walls2', this.tileset, 0, 0);

    if (this.walls && this.walls2) {
      this.walls.setCollisionByExclusion([-1]); // excludes only empty tiles
      this.walls2.setCollisionByExclusion([-1]); // excludes only empty tiles

      this.tilemapColliders = [
        { walls: this.walls, handler: 'touchWall' },
        { walls: this.walls2, handler: 'touchFireWall' },
      ];
    }

    if (!this.tilemap) return;

    this.tileObjects = this.tilemap.getObjectLayer('objects');
    if (!this.tileObjects) return;
    this.tileObjects.objects.forEach(obj => {
      if (this.spawnManager[obj.name]) {
        this.spawnManager[obj.name]?.(obj.x, obj.y, obj);
      } else {
        this[obj.name]?.(obj.x, obj.y, obj);
      }
    });

  }

  cleanupScene() {
    if (this.layer1) { this.layer1.destroy(); this.layer1 = null; }
    if (this.layer2) { this.layer2.destroy(); this.layer2 = null; }
    if (this.walls) { this.walls.destroy(); this.walls = null; }
    if (this.walls2) { this.walls2.destroy(); this.walls2 = null; }

    if (this.tilemap) { this.tilemap.destroy(); this.tilemap = null; }

    // The ghost is a display-list child, so shutdown destroys it anyway;
    // clear the references so a restarted scene never reuses a dead one.
    this.trialGhost = null;
    this.trialRecording = null;
  }

  setupGroups() {
    this.weaponGroup = new WeaponGroup(this, this.player);
    this.spawnManager.setupGroups(this);
    this.walkableGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    this.interactGroup = [];

    const spawnGroups = this.spawnManager.getGroups();

    this.attackableGroups = [
      { group: this.walkableGroup, handler: 'platformHit', zap: false },
      ...spawnGroups,
    ]

    this.walkingGroups = [
      { group: this.physics.add.group({ runChildUpdate: true }).add(this.player) },
      ...spawnGroups.filter(({ walls }) => walls ?? true),
    ]
  }

  setupCollisions() {
    const spawnGroups = this.spawnManager.getGroups();

    this.attackableGroups.forEach(({ group, handler }) =>
      this.weaponOverlap = this.physics.add.overlap(group, this.weaponGroup, (target, weapon) => {
        weapon[handler]?.(target);
      },
        null,
        this
      ));

    spawnGroups.forEach(({ group }) =>
      this.enemyOverlap = this.physics.add.overlap(this.player, group, (player, entity) => {
        entity.playerCollide?.(player);
      }, null, this));


    this.walkingGroups.forEach(({ group }) =>
      this.walkCollider = this.physics.add.collider(group, this.walkableGroup, (entity, wall) => {
        entity.touchWall?.(wall);
      }, null, this));

    // TileMap wall collisions
    if (this.tilemapColliders?.length) {
      this.tilemapColliders.forEach(({ walls, handler }) => {
        this.tileCollider1 = this.physics.add.collider(walls, this.weaponGroup, null, (wall, weapon) => {
          weapon[handler]?.(wall);

          if (weapon.ignoreWall) {
            return false;
          }
          return true;
        }, this);

        this.walkingGroups.forEach(({ group }) =>
          this.tileCollider2 = this.physics.add.collider(group, walls, (entity, wall) => {
            entity[handler]?.(wall);
          }, null, this));
      });
    }

    this.weaponWalkableCollider = this.physics.add.collider(this.weaponGroup, this.walkableGroup);


  }

  setupMusic(key) {
    SoundUtil.setup(this, key, GameManager.volume.music ?? 1);

    this.sound.pauseOnBlur = false;
    this.sfx = {};

    // setupMusic runs on every level load, but Phaser's Systems.shutdown()
    // only emits 'shutdown' — it never removes listeners (only destroy()
    // does), so a plain .on() would stack one sfx-cleanup handler per
    // visited level on the same scene instance. .once() self-removes after
    // firing, same replace-not-stack convention as the other per-level
    // listeners (Days 14/19/20).
    this.events.once('shutdown', () => {
      for (const key in this.sfx) {
        this.sfx[key].forEach(sound => {
          sound.stop();
          sound.destroy();
        });
      }
      this.sfx = {};
    });

  }

  setupPlatforms(platformPos = [[0, 800]]) {
    platformPos.forEach(pos => this.walkableGroup.create(pos[0], pos[1], 'platform'));
  }

  setupQuick(x = 0, y = 0) {
    this.setupSky();
    this.setupWorld();
    this.setupPlayer(x, y);
    this.setupGroups();
    this.setupTileMap()
    this.setupCollisions();
    this.setupMusic();
  }

  shrinkCollision(object, x, y) {
    object.body.setSize(x, y); // Smaller than sprite size
    object.body.setOffset(
      (object.width - x) / 2,
      (object.height - y) / 2
    );
  }

  loadingBar() {
    // Create a progress bar background
    const { width, height } = this.cameras.main;
    const barWidth = 300;
    const barHeight = 30;
    const barX = (width - barWidth) / 2;
    const barY = (height - barHeight) / 2;

    const progressBarBg = this.add.graphics();
    progressBarBg.fillStyle(0x222222, 1);
    progressBarBg.fillRect(barX, barY, barWidth, barHeight);

    const progressBar = this.add.graphics();

    // Optional: Add text
    const loadingText = this.add.text(width / 2, barY - 40, 'Loading...', {
      fontSize: '20px',
      fill: '#ffffff'
    }).setOrigin(0.5);

    // Listen to loading progress
    this.load.on('progress', (value) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(barX, barY, barWidth * value, barHeight);
      if (value === 1) {
        loadingText.destroy();
        progressBar.clear();
      }
    });
  }

  spawnSunman(x, y) {
    this.spawnManager.spawnSunMan(x, y, 10)
  }

  spawnBullets(x, y, text) {
    const delay = parseInt(text, 10);

    this.time.addEvent({
      delay: delay,
      loop: true,
      callback: () => {
        this.spawnManager.spawnBullet(x, y);
      }
    })
  }

  spawnSourceBlock(x, y) {
    const block = this.spawnManager.spawnSourceBlock(x, y);
  }

  spawnBooster(x, y, obj) {
    this.spawnManager.spawnBooster(x, y, obj);
  }

  setupRaceTimer() {
    this.raceTime = 0;
    if (this.raceTimeText) this.raceTimeText.destroy();
    this.raceTimeText = this.add.text(this.scale.width, 0, this.raceTime, {
      fontSize: '44px',
    })
      .setOrigin(1, 0)
      .setScrollFactor(0);
    if (this.raceTimer) {
      this.time.removeEvent(this.raceTimer);
    }
    this.raceTimer = this.time.addEvent({
      delay: 10,
      loop: true,
      callback: () => {
        this.raceTime += .01;
        this.raceTimeText?.setText(this.raceTime.toFixed(2));
      },
    })
    // A fresh race clock means a fresh run: restart the recording and
    // the ghost replay with it (death restarts the scene, so this also
    // resets the ghost on respawn).
    this.startTrialRun();
  }

  // Time-trial ghost lifecycle (no-op unless the level opted in).
  startTrialRun() {
    this.stopTrialGhost();
    this.trialRecording = null;
    this.trialFinished = false;
    if (!this.trialEnabled || !this.player) return;
    this.trialRecording = new TimeTrialRecorder(this);
    // Only show the ghost when this run starts where a stored best
    // started — World 1 respawns at checkpoints, so a best leg only
    // replays from its own checkpoint (bestRunForStart picks the best
    // for THIS start point, within tolerance).
    const found = bestRunForStart(GameManager.bestRuns?.[this.key], this.player.x, this.player.y);
    if (found) {
      this.trialGhost = new TimeTrialGhost(this, found.run);
    }
  }

  stopTrialGhost() {
    if (this.trialGhost) {
      this.trialGhost.destroy();
      this.trialGhost = null;
    }
  }

  // Called by the finish line (and World 1's vault portal via the same
  // FinishLine class) with the final race time. Saves the recording
  // when it beats the stored best for this run's start point.
  onTrialFinish(time) {
    if (!this.trialEnabled || this.trialFinished) return;
    this.trialFinished = true;
    const recording = this.trialRecording;
    this.trialRecording = null;
    this.stopTrialGhost();
    if (!recording || typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return;
    const run = recording.toBestRun(Math.round(time * 100) / 100);
    if (!run) return; // capped run: recording incomplete, keep the old best
    // One best per start point: this run only ever competes with the
    // best from ITS start, so a fast checkpoint leg can never
    // overwrite the full-run best (or any other leg's best).
    GameManager.bestRuns ??= {};
    const levelBest = GameManager.bestRuns[this.key] ?? (GameManager.bestRuns[this.key] = {});
    const key = startKeyFor(run.startX, run.startY);
    const prev = bestRunForStart(levelBest, run.startX, run.startY);
    if (prev && time >= prev.run.time) return;
    // A within-tolerance match under a different key is the same
    // start point (a spawn that moved a few px between versions):
    // drop the old key so one start never holds two bests.
    if (prev && prev.key !== key) delete levelBest[prev.key];
    // Bound the save: a level only has a handful of starts, so a new
    // start past the cap is dropped rather than evicting a best.
    if (!levelBest[key] && Object.keys(levelBest).length >= TRIAL_MAX_STARTS) return;
    levelBest[key] = run;
    GameManager.save();
    // Small fanfare at the finish: floating "NEW BEST!" that fades out.
    const label = this.add.text(this.player.x, this.player.y - 90, 'NEW BEST!', {
      fontSize: '24px',
      color: '#66ffee',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    label.setDepth(9);
    this.tweens.add({
      targets: label,
      y: label.y - 40,
      alpha: 0,
      duration: 1600,
      onComplete: () => label.destroy(),
    });
  }


  updateScoreBoard(data) {
    if (!this.scoreBoard) {
      this.scoreBoard = {};
    }

    if (!data) return;

    data.forEach(obj => {
      switch (obj.level) {
        case this.key:
          let x = this.finishLine?.x ?? 0;
          let y = this.finishLine?.y ?? 0;
          // recreate scoreboard
          if (this.scoreBoard[obj.level]) {
            this.scoreBoard[obj.level].destroy();
          }

          const board = new ScoreBoard(this, x + 135, y - 125, obj.scores);
          this.add.existing(board);
          this.scoreBoard[obj.level] = board;
          break;
        default:
          break;
      }
    })
  }
}