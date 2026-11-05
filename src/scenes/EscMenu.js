import { getChatting } from "../domStuff/Chat.js";
import { addSettingsButton } from "../domStuff/KeyBinds.js";
import { isTouchDevice } from "../domStuff/TouchControls.js";
import { mapRangeClamped } from "../myFunctions.js";
import GameManager from "../things/GameManager.js";
import NetworkManager from "../things/NetworkManager.js";
import SoundUtil from "../things/soundUtils.js";

// Yaya's Discord server invite — text link in the menu only, no iframe/widget.
const DISCORD_INVITE_URL = "https://discord.gg/3bcgswDBfY";

export default class EscMenu extends Phaser.Scene {
    constructor() {
        super('EscMenu');
    }

    init(data) {
        this.gameScene = data.gameScene;
        this.playerUI = data.playerUI;
        this.nameInput = null;
        this.colorInput = null;
    }

    create() {
        this.visible = false;
        this.input.enabled = false;
        this.scene.setVisible(false);
        // NOTE: do NOT call scene.setActive(false) here. Deactivating makes
        // !scene.isActive('EscMenu') in _basegame re-run create() without
        // shutdown on every respawn/portal, stacking keydown-ESC listeners
        // (Settings double-toggles closed on every odd respawn).

        this.uiElements = [];

        this.network = NetworkManager.instance;

        // The menu is laid out for an 800x600 panel. Wrap everything in
        // one container so narrow viewports (phones) get a scaled-down,
        // centered panel instead of content hanging off-screen — the
        // volume sliders at x=600 and the name/color inputs at x=600,350
        // were unreachable on a phone. Desktop viewports (>=800x600) keep
        // scale 1 at (0,0), pixel-identical to the old layout.
        //
        // Touch tap targets: at 360px wide the panel renders at 0.45x, so
        // every interactive text/button below gets a padded hit area in
        // panel space (invisible — no visual change). Phaser hit areas
        // are in the object's frame space (top-left = 0,0), so negative
        // padding origins are correct for Text (origin 0,0) and Shapes.
        const padHit = (obj, padX, padY, shape) => {
            const w = obj.width, h = obj.height;
            // Circle branch uses an ellipse: the four slider handles sit
            // 50px apart vertically, so vertical padding must stay under
            // 25px or neighboring handles' hit areas overlap and the wrong
            // slider grabs. Horizontal padding can be generous.
            const hitArea = shape === 'circle'
                ? new Phaser.Geom.Ellipse(w / 2, h / 2, w + padX * 2, h + padY * 2)
                : new Phaser.Geom.Rectangle(-padX, -padY, w + padX * 2, h + padY * 2);
            const cb = shape === 'circle' ? Phaser.Geom.Ellipse.Contains : Phaser.Geom.Rectangle.Contains;
            obj.setInteractive({ hitArea, hitAreaCallback: cb, useHandCursor: true });
        };
        this.menuPanel = this.add.container(0, 0);
        this.fitMenu();
        // The game uses Phaser.Scale.RESIZE, so re-fit on viewport change.
        // Replace (not stack), same convention as Inventory's fitCamera.
        this.scale.off('resize', this.fitMenu, this);
        this.scale.on('resize', this.fitMenu, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.fitMenu, this));

        // Background
        this.bg = this.add.rectangle(0, 0, 800, 600, 0x000000, 0.8).setOrigin(0, 0);
        this.menuPanel.add(this.bg);

        // The four volume sliders share geometry; createSlider builds each one
        // (label, track, draggable handle) so the blocks don't repeat.
        const createSlider = (y, name) => {
            // Center the label over its own track so each of the four
            // labels lines up with its slider (kept at setOrigin(0.5)).
            const label = this.add.text(600, y - 10, name).setOrigin(0.5);
            const track = this.add.rectangle(600, y, 200, 10, 0xffffff).setOrigin(0.5);
            // Touch: a bigger handle and a generous hit area — at the
            // phone panel scale (0.45x) the 10px handle was a ~9px drag
            // target. Desktop keeps Josh's 10px dots; both get the padded
            // hit area so grabbing a slider is forgiving.
            const hr = isTouchDevice() ? 15 : 10;
            const handle = this.add.circle(600, y, hr, 0xff0000);
            // Wide horizontal / narrow vertical padding: the handles sit
            // 50px apart, so vertical padding stays small to avoid
            // neighboring hit areas overlapping (see padHit).
            padHit(handle, 24, 6, 'circle');
            this.input.setDraggable(handle);
            handle.name = name;
            this.menuPanel.add(label, track, handle);
            return { track, handle };
        };

        this.sliders = {
            master: createSlider(400, 'master'),
            music: createSlider(450, 'music'),
            voice: createSlider(500, 'voice'),
            mic: createSlider(550, 'mic'),
        };

        const donate = this.add.text(300, 25,
            'Made by: Josh Massarella\nDonate to help me make more games!', {
            fontSize: '24px',
            color: '#FFFFFF',
        });
        // Padded tap target for the scaled-down phone panel (padHit above).
        padHit(donate, 16, 12);
        donate
            .on('pointerdown', () => {
                window.open('https://buymeacoffee.com/krazay', '_blank', 'noopener');
            })
            .on('pointerover', () => {
                donate.setColor('#00FF00');
            })
            .on('pointerout', () => {
                donate.setColor('#FFFFFF')
            })
        this.menuPanel.add(donate);

        const instructions = this.add.text(0, 50,
            isTouchDevice()
                ? 'Left thumb - Move / Crouch\nRight buttons - Jump / Dash / Attack\nPause menu - Heal, Items, Home, Voice, Chat'
                : 'ASD - Move\nW - Heal\nSPACE - Jump\nSHIFT - dash\nL/R Click - Attack\nC -Inventory\nT - Home\n<-/-> - Spectate Others\nUpArrow^ - Spectate Self', {
            fontSize: '28px',
            color: '#4fffff',
        });
        instructions.setScrollFactor(0);
        this.menuPanel.add(instructions);

        // Name display
        this.nameDisplay = this.add.text(600, 250, GameManager.name.text || 'Hunter', {
            fontSize: '32px',
            fontStyle: 'bold',
            color: GameManager.name.color || '#FFFFFF',
        }).setOrigin(0.5);
        this.menuPanel.add(this.nameDisplay);

        // Store all UI elements for visibility toggling
        //this.uiElements.push(this.bg, this.nameDisplay, track, handle, track1, handle1, instructions, this.resetButton, resetText);

        // Hide initially
        //this.setUIVisible(false);



        // RESET is destructive (wipes ALL progress), so it gets a
        // two-step confirm: first tap only ARMS it (red label, 3s
        // window); a second tap inside the window executes. Closing the
        // menu or the 3s timeout disarms back to the safe state.
        let resetEntry = null;
        let resetArmed = false;
        let resetDisarmTimer = null;
        const disarmReset = () => {
            resetArmed = false;
            if (resetDisarmTimer) {
                resetDisarmTimer.remove(false);
                resetDisarmTimer = null;
            }
            // resetEntry is still null before the entries are built below.
            if (resetEntry) resetEntry.setText('RESET').setColor('#FFFFFF');
        };

        // ESC key
        const toggleSettings = () => {
            this.visible = !this.visible;

            if (this.visible) {
                this.scene.pause(this.gameScene);
                this.input.enabled = true;
                this.scene.setVisible(true);
                this.openNameInput();
                this.openColorInput();
            } else {
                disarmReset();
                this.scene.resume(this.gameScene);
                this.input.enabled = false;
                this.scene.setVisible(false);
                this.destroyNameInput();
                this.destroyColorInput();
            }
        }

        this.input.keyboard.on('keydown-ESC', (e) => {
            // Ignore key repeat: holding ESC re-fires keydown ~30x/sec and
            // each one toggles the menu, so it flickers and can end in the
            // wrong state (same class as the keydown-C inventory fix).
            // The touch menu emits this event with no event object, so the
            // guard must tolerate an undefined e.
            if (e?.repeat) return;
            if(getChatting()) return;
            // If the inventory DOM panel is open, ESC closes it (handled
            // by Inventory's own keydown-ESC) — don't toggle settings too.
            if (document.getElementById('inventory-panel')) return;
            // Same for the shard shop DOM panel: its own Esc listener
            // closes it — the menu must not toggle behind it.
            if (document.getElementById('shard-shop')) return;
            toggleSettings();
        })
        // Close-only variant of toggleSettings: after a level restart
        // (Respawn restarts the level scene, which re-runs this create
        // and resets visible to false), toggling here would reopen the
        // menu instead of closing it. Closing unconditionally is safe
        // in both cases.
        const closeMenu = () => {
            disarmReset();
            if (!this.visible) return;
            this.visible = false;
            this.scene.resume(this.gameScene);
            this.input.enabled = false;
            this.scene.setVisible(false);
            this.destroyNameInput();
            this.destroyColorInput();
        };

        // The gear is re-created on every EscMenu launch, and a level
        // restart re-launches it — remove the previous gear first, or
        // stale gears pile up in the grid (same replace-not-stack rule
        // as the voice/debug buttons).
        document.querySelector('.kb-button[data-action="SettingsButton"]')?.remove();
        addSettingsButton(toggleSettings)

        // Menu entries for the three actions with no phone button
        // (package B: Inventory / Home / Respawn live here instead of
        // on the thumb grid). Same actions as the C / T / R keys.
        // opts lets one entry differ (RESET: bigger tap target, red
        // armed colors) without changing the others' behavior.
        const menuAction = (label, y, onTap, opts = {}) => {
            const entry = this.add.text(0, y, label, {
                fontSize: opts.fontSize || '28px',
                color: opts.color || '#FFFFFF',
            });
            // Padded tap target for the scaled-down phone panel (padHit
            // above). padY is 10 (not larger) so the three entries'
            // hit areas barely touch instead of overlapping.
            padHit(entry, opts.padX ?? 28, opts.padY ?? 10);
            const baseColor = () => (opts.baseColor ? opts.baseColor() : '#FFFFFF');
            const hoverColor = () => (opts.hoverColor ? opts.hoverColor() : '#00FF00');
            entry
                .on('pointerdown', onTap)
                .on('pointerover', () => entry.setColor(hoverColor()))
                .on('pointerout', () => entry.setColor(baseColor()));
            this.menuPanel.add(entry);
            return entry;
        };

        menuAction('INVENTORY', 320, () => {
            const inv = this.gameScene.invMenu;
            if (!inv) return;
            // The inventory is a DOM panel now; toggle via its controller.
            if (inv.isPanelOpen()) inv.closePanel();
            else inv.openPanel();
            closeMenu();
        });

        menuAction('HOME', 370, () => {
            const player = this.gameScene.player;
            if (player && ((this.gameScene.scene.key !== 'Home' && player.body.blocked.down && !player.chatting) || !player.alive)) {
                GameManager.useLastLocation = false;
                GameManager.save();
                // Close the menu first (it would otherwise stay open over
                // Home), then go through the level's own scene plugin so the
                // level is stopped — exactly like the desktop T key.
                // SceneManager.start would leave the old level running
                // behind Home with the menu still on top.
                closeMenu();
                this.gameScene.scene.start('Home');
            }
        });

        menuAction('RESPAWN', 420, () => {
            const player = this.gameScene.player;
            if (player && ((player.body.blocked.down && !player.chatting) || !player.alive)) {
                player.respawnPlayer();
                closeMenu();
            }
        });

        // Reset used to be a floating white box in the corner; it now
        // sits with the other menu entries. It is the one destructive
        // entry, so it needs a two-step confirm: the first tap only
        // ARMS it (red "tap again" label, 3s window) and the second tap
        // inside the window executes the reset — exactly as before:
        // wipe progress and go Home through the level's own scene
        // plugin (see HOME). RESET sits 80px below RESPAWN (was 50)
        // with a ~98px hit height: at the 0.45x phone panel scale that
        // is a 44px physical tap target, with no overlap into RESPAWN
        // above or the Discord link below.
        resetEntry = menuAction('RESET', 500, () => {
            if (!resetArmed) {
                resetArmed = true;
                resetEntry.setText('Tap again to wipe ALL progress');
                // Re-pad: the armed label is wider than 'RESET' and the
                // whole visible label must be tappable for the 2nd tap.
                padHit(resetEntry, 60, 33);
                resetEntry.setColor('#FF3333');
                // Auto-disarm if the second tap never comes.
                resetDisarmTimer = this.time.delayedCall(3000, disarmReset);
                return;
            }
            // Second tap inside the window: run the reset, then disarm.
            disarmReset();
            GameManager.reset();
            closeMenu();
            this.gameScene.scene.start('Home');
        }, {
            padX: 60,
            padY: 33,
            baseColor: () => (resetArmed ? '#FF3333' : '#FFFFFF'),
            hoverColor: () => (resetArmed ? '#FF3333' : '#00FF00'),
        });

        // Small, out-of-the-way text link to Yaya's Discord invite (text
        // only — the Discord widget iframe was removed on purpose).
        const discord = this.add.text(16, 572, 'Join our Discord', {
            fontSize: '16px',
            color: '#9aa3ff',
        });
        // Padded tap target: at the phone panel scale the raw 16px text
        // is a ~7px target. Padding is invisible (padHit above).
        padHit(discord, 20, 14);
        discord
            .on('pointerdown', () => {
                // 'noopener': like the donate link above, a bare _blank lets
                // the opened page keep a window.opener reference
                // (reverse-tabnabbing surface).
                window.open(DISCORD_INVITE_URL, '_blank', 'noopener');
            })
            .on('pointerover', () => discord.setColor('#cdd3ff'))
            .on('pointerout', () => discord.setColor('#9aa3ff'));
        this.menuPanel.add(discord);

        // Slider drag logic
        this.input.on('drag', (pointer, gameObject, dragX) => {
            const slider = this.sliders[gameObject.name];
            if (!slider) return; // only the four slider handles are draggable
            const minX = slider.track.x - slider.track.width / 2;
            const maxX = slider.track.x + slider.track.width / 2;

            dragX = Phaser.Math.Clamp(dragX, minX, maxX);
            gameObject.x = dragX;

            const percent = (dragX - minX) / (maxX - minX);

            if (gameObject.name === 'music') {
                GameManager.volume.music = percent
                GameManager.save();
                if (!SoundUtil.currentMusic) return;
                SoundUtil.currentMusic.volume = percent;
            } else if (gameObject.name === 'master') {
                this.sound.volume = percent;

                GameManager.volume.master = percent;
                GameManager.save();
            } else if (gameObject.name === 'voice') {
                GameManager.volume.voice = percent;
                this.network.voiceChat.updateVolumes();
                GameManager.save();
            } else if (gameObject.name === 'mic') {
                const value = mapRangeClamped(percent, 0, 1, -3, 3);
                this.network.voiceChat.setMicVolume(percent);
            }
        });

        this.setInitialVolume(GameManager.volume);
    }

    // Fit the 800x600 menu panel to the viewport. Desktop (>=800x600)
    // keeps scale 1 at (0,0) — identical to the old layout — while
    // narrow screens (phones) get the panel scaled down and centered so
    // nothing is cut off. Phaser reports drag positions in the
    // container's local space, so the slider drag math below is
    // unchanged.
    fitMenu() {
        const s = Math.min(1, this.scale.width / 800, this.scale.height / 600);
        this.menuPanel.setScale(s);
        this.menuPanel.setPosition(
            Math.max(0, (this.scale.width - 800 * s) / 2),
            Math.max(0, (this.scale.height - 600 * s) / 2)
        );
    }

    // setUIVisible(visible) {
    //     this.uiElements.forEach(obj => obj.setVisible(visible));
    //     if (this.nameInput) this.nameInput.setVisible(visible);
    //     if (this.colorInput) this.colorInput.setVisible(visible);
    // }

    setInitialVolume(volume) {
        // GameManager.volume persists master/music/voice only; the mic
        // handle is not persisted, so it keeps its created position.
        for (const name of ['master', 'music', 'voice']) {
            const slider = this.sliders[name];
            const minX = slider.track.x - slider.track.width / 2;
            const maxX = slider.track.x + slider.track.width / 2;
            slider.handle.x = Phaser.Math.Linear(minX, maxX, volume[name]);
        }
        this.sound.volume = volume.master ?? 1;
    }

    openNameInput() {
        this.nameInput = this.add.dom(600, 300).createFromHTML(`
            <input type="text" id="nameInput" name="name" placeholder="Enter name"
                   style="font-size: 20px; width: 200px; padding: 5px;" />
        `).setOrigin(0.5);
        this.menuPanel.add(this.nameInput);


        const domElement = this.nameInput.getChildByName('name');
        domElement.value = GameManager.name.text || 'Hunter';

        domElement.addEventListener('focus', () => {
            this.playerUI.inputFocused = true;
        });

        domElement.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.stopImmediatePropagation();
                const name = domElement.value.trim();
                GameManager.name.text = name;
                this.nameDisplay.setText(name);
                GameManager.save();

                this.network.socket.emit('playerName', { text: GameManager.name.text, color: GameManager.name.color });

                domElement.blur();
                this.playerUI.inputFocused = false;
            }
        });
    }

    destroyNameInput() {
        if (this.nameInput) {
            const domElement = this.nameInput.getChildByName('name');
            const name = domElement.value.trim();
            GameManager.name.text = name;
            this.nameDisplay.setText(name);
            GameManager.save();

            this.network.socket.emit('playerName', { text: GameManager.name.text, color: GameManager.name.color });

            this.nameInput.destroy();
            this.nameInput = null;
            this.playerUI.inputFocused = false;
        }
    }

    openColorInput() {
        this.colorInput = this.add.dom(600, 350).createFromHTML(`
            <input type="color" id="nameColor" value="${GameManager.name.color || '#ffffff'}"
                   style="width: 80px; height: 40px; border: none;" />
        `).setOrigin(0.5);
        this.menuPanel.add(this.colorInput);

        const colorPicker = this.colorInput.getChildByID('nameColor');
        colorPicker.addEventListener('input', (event) => {
            const color = event.target.value;
            GameManager.name.color = color;
            this.nameDisplay.setColor(color);
            GameManager.save();

            this.network.socket.emit('playerName', { text: GameManager.name.text, color: GameManager.name.color });
        });
    }

    destroyColorInput() {
        if (this.colorInput) {
            this.colorInput.destroy();
            this.colorInput = null;
        }
    }
}
