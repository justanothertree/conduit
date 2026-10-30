import { getChatting } from "../domStuff/Chat.js";
import { addSettingsButton } from "../domStuff/KeyBinds.js";
import { mapRangeClamped } from "../myFunctions.js";
import GameManager from "../things/GameManager.js";
import NetworkManager from "../things/NetworkManager.js";
import SoundUtil from "../things/soundUtils.js";

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
        this.scene.setActive(false);

        this.uiElements = [];

        this.network = NetworkManager.instance;

        // The menu is laid out for an 800x600 panel. Wrap everything in
        // one container so narrow viewports (phones) get a scaled-down,
        // centered panel instead of content hanging off-screen — the
        // volume sliders at x=600 and the name/color inputs at x=600,350
        // were unreachable on a phone. Desktop viewports (>=800x600) keep
        // scale 1 at (0,0), pixel-identical to the old layout.
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

        this.resetButton = this.add.rectangle(0, 0, 225, 75, 0xFFFFFF, 1)
            .setInteractive()
            .on('pointerdown', () => {
                GameManager.reset();
                // Same transition fix as the HOME menu entry: close the menu
                // and stop the level via its own scene plugin, instead of
                // SceneManager.start leaving the old level running.
                closeMenu();
                this.gameScene.scene.start('Home');
            });
        const resetText = this.add.text(0, 0, 'RESET', {
            font: '32px',
            fill: '#FF0000',
        })
        this.menuPanel.add(this.resetButton, resetText);

        // The four volume sliders share geometry; createSlider builds each one
        // (label, track, draggable handle) so the blocks don't repeat.
        const createSlider = (y, name) => {
            const label = this.add.text(400, y - 10, name);
            const track = this.add.rectangle(600, y, 200, 10, 0xffffff).setOrigin(0.5);
            const handle = this.add.circle(600, y, 10, 0xff0000).setInteractive();
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
        })
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                window.open('https://buymeacoffee.com/krazay');
            })
            .on('pointerover', () => {
                donate.setColor('#00FF00');
            })
            .on('pointerout', () => {
                donate.setColor('#FFFFFF')
            })
        this.menuPanel.add(donate);

        const instructions = this.add.text(0, 50,
            'ASD - Move\nW - Heal\nSPACE - Jump\nSHIFT - dash\nL/R Click - Attack\nC -Inventory\nT - Home\n<-/-> - Spectate Others\nUpArrow^ - Spectate Self', {
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
                this.scene.resume(this.gameScene);
                this.input.enabled = false;
                this.scene.setVisible(false);
                this.destroyNameInput();
                this.destroyColorInput();
            }
        }

        this.input.keyboard.on('keydown-ESC', () => {
            if(getChatting()) return;
            toggleSettings();
        })
        // Close-only variant of toggleSettings: after a level restart
        // (Respawn restarts the level scene, which re-runs this create
        // and resets visible to false), toggling here would reopen the
        // menu instead of closing it. Closing unconditionally is safe
        // in both cases.
        const closeMenu = () => {
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
        const menuAction = (label, y, onTap) => {
            const entry = this.add.text(0, y, label, {
                fontSize: '28px',
                color: '#FFFFFF',
            })
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', onTap)
                .on('pointerover', () => entry.setColor('#00FF00'))
                .on('pointerout', () => entry.setColor('#FFFFFF'));
            this.menuPanel.add(entry);
            return entry;
        };

        menuAction('INVENTORY', 320, () => {
            const inv = this.gameScene.invMenu;
            if (!inv) return;
            if (inv.scene.isVisible()) {
                inv.scene.setVisible(false);
                inv.input.enabled = false;
                inv.scene.setActive(false);
            } else {
                inv.scene.setVisible(true);
                inv.scene.setActive(true);
                inv.input.enabled = true;
            }
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
