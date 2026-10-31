import GameManager from "./GameManager.js";
import NetworkManager from "./NetworkManager.js";
import { createWeapon } from "../weapons/WeaponManager.js"
import ChatBubble from "./chatBubble.js";
import PlayerContainer from "./playerContainer.js";
import SoundUtil, { playSound } from "./soundUtils.js";
import { getChatting } from "../domStuff/Chat.js";
import { getTouchAimPointer } from "../domStuff/touchAim.js";
import { setupPlayerStates } from "./playerStuff/playerStates.js";
import { playerTakeDamage, playerAdjustHealth, playerUpdateHealth } from "./playerStuff/playerHealth.js";
import { playerSyncGhost, playerSyncNetwork, playerSpectatePlayer } from "./playerStuff/playerNetwork.js";
import { playerHandleInput, playerDecideState, playerGetInput, playerSetState, playerWalkLerp } from "./playerStuff/playerInput.js";

export default class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'dudesheet');

        GameManager.load();
        this.network = NetworkManager.instance;

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.body.setMaxSpeed(1000);
        this.setMaxVelocity(1500, 1500);


        this.setupAnimation();
        this.syncNetwork()

        this.lastSentState = {};

        this.damageSound = 'playerHit';

        this.setScale(0.35);
        this.setDepth(10);
        this.setSize(115, 250);
        this.setOffset(70, 0);
        this.baseHitBoxSize = { y: 250, yo: 0 };
        this.alive = true;
        this.stats = { health: 25, healthMax: 25 }
        this.healthMax = 25;
        this.health = 25;
        this.deathPenalty;
        this.money = GameManager.power.money;
        this.auraLevel = GameManager.power.auraLevel;
        this.name = GameManager.name;

        this.isCrouch = false;
        this.baseJumpPower = 150;
        this.jumpPower = this.baseJumpPower;
        this.jumpMax = 400;
        this.canJump = true;
        this.canDash = true;
        this.canResetDash = true;
        this.dashSpeed = 900;
        this.canSlide = true;
        this.crouchCD = 0;
        this.wallJump = false;
        this.wallJumpX = 0;
        this.stunned = false;
        this.iFrame = false;
        this.hitCD = false;
        this.spawnBuffer = true;
        this.meditateTimer = 0;

        // this.playerUI;
        // if (!this.scene.scene.isActive('EscMenu')) {
        // this.scene.scene.launch('EscMenu', { gameScene: this.scene });
        // } else {

        // }
        // if (!this.scene.scene.isActive('Inventory')) {
        // this.scene.scene.launch('Inventory', { player: this });
        // }
        // if (!this.scene.scene.isActive('PlayerUI')) {
        // this.scene.scene.launch('PlayerUI', { player: this });
        // }

        // this.playerContainer = new PlayerContainer(scene, this.x, this.y);
        this.equipWeapon(GameManager.weapons.left, 0);
        this.equipWeapon(GameManager.weapons.right, 1);
        this.equipWeapon('zap', 2)
        this.weapons = [this.leftWeapon, this.rightWeapon];

        this.healthTick = 0;
        this.tryLeftAttack = false;
        this.canLeftAttack = true;
        this.canRightAttack = true;
        this.leftSpam = 0;
        this.rightSpam = 0;
        this.speed = 250;
        this.test = 0;
        this.buffColor = 0x66ff33;

        this.controls = {
            up: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
            jump: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false),
            down: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false),
            left: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
            right: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
            dash: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT, false),
        };

        this.myPointer = new Phaser.Input.Pointer(this.scene.input.manager, 1)

        this.scene.input.on('pointerdown', (pointer) => {
            if (GameManager.flags.devmode && pointer.middleButtonDown()) {
                const worldPos = pointer.positionToCamera(this.scene.cameras.main);
                this.setPosition(worldPos.x, worldPos.y);
                this.setVelocity(0);
            } else {
                // const distance = new Phaser.Math.Vector2(pointer)
                // scene.cameras.main.setOffset
            }
        });
        this.scene.input.keyboard.on('keydown-G', () => {
            if (GameManager.flags.devmode && !this.chatting && !getChatting()) {
                this.updateMoney(500000);
            }
        });
        this.scene.input.keyboard.on('keydown-F', () => {
            if (this.chatting || !this.scene || !this.alive || getChatting()) return;
            if (!this.scene.interactGroup) return;
            this.scene.interactGroup.forEach((interact) => {
                if (interact && interact.isInteractable && Phaser.Math.Distance.Between(this.x, this.y, interact.x, interact.y) < 150) {
                    interact.interact(this);
                    return;
                }
            });
        });

        this.spectateIndex = 0;
        this.scene.input.keyboard.on('keydown-LEFT', () => {
            this.spectatePlayer(true, -1);
        });
        this.scene.input.keyboard.on('keydown-UP', () => {
            this.spectatePlayer(false);
        });
        this.scene.input.keyboard.on('keydown-RIGHT', () => {
            this.spectatePlayer(true, 1);
        });

        this.scene.input.on('pointerup', (pointer) => {
            if (pointer.leftButtonReleased()) {
                this.leftWeapon.release();
            } else if (pointer.rightButtonReleased()) {
                this.rightWeapon.release();
            }
        });

        this.scene.input.keyboard.on('keydown-T', () => {
            if (this.scene.scene.key !== 'Home' && this.body.blocked.down && !this.chatting || !this.alive) {
                GameManager.useLastLocation = false;
                GameManager.save();
                this.scene.scene.start('Home')
            }
        });

        this.scene.input.keyboard.on('keydown-R', () => {
            if (this.body.blocked.down && !this.chatting || !this.alive) {
                this.respawnPlayer();
                // GameManager.useLastLocation = false;
                // GameManager.save();
                // this.scene.scene.restart();
            }
        });

        this.scene.time.delayedCall(400, () => {
            this.spawnBuffer = false;
        })

        // window.addEventListener('blur', () => {
        //     this.windowFocused = false;
        //     console.log('focusOut')
        // })
        // window.addEventListener('focus', () => {
        //     this.windowFocused = true;
        //     console.log('focusIn')
        // })

        this.updateMoney();
        this.setupStates();
        this.resetJump();
        this.setStats();
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.chatBubble) this.chatBubble.setPosition(this.x, this.y - 100);
        if (this.playerContainer) this.playerContainer.setPosition(this.x, this.y);

        if (this.alive && !this.stunned) {
            if (!this.leftWeapon) return;
            if (!this.rightWeapon) return;
            this.leftWeapon.update?.(delta);
            this.rightWeapon.update?.(delta);
            if (this.aura) this.aura.update?.(delta);

            if (this.y > this.scene.physics.world.bounds.height + this.body.height + 150 && this.alive && !this.spawnBuffer) {
                this.Died();
            }

            if (this.currentState === 'meditate') return;
            const pointer = this.scene.input.activePointer;

            if (pointer.leftButtonDown() && !this.inventory.scene.isVisible()) {
                this.leftWeapon.fire(pointer);
                this.meditateTimer = 0;
            }
            if (pointer.rightButtonDown() && !this.inventory.scene.isVisible()) {
                this.rightWeapon.fire(pointer);
                this.meditateTimer = 0;
            }
            // Touch Attack button: fires the primary weapon at the auto-aim
            // point (nearest enemy, else facing direction). Desktop mouse
            // path above is unchanged; this only maps touch input onto the
            // existing fire action.
            if (document.attackButton?.isClicked && !this.inventory.scene.isVisible()) {
                this.leftWeapon.fire(getTouchAimPointer(this));
                this.meditateTimer = 0;
            }
        }
        if (this.knockbackVelocity) {
            if (this.knockbackVelocity.length() > 0.1) {
                this.setVelocityX(this.knockbackVelocity.x); // or setVelocity if using Arcade
                this.setVelocityY(this.knockbackVelocity.y);
                this.knockbackVelocity.scale(0.9); // decay over time
            } else {
                this.knockbackVelocity.set(0, 0);
            }
        }
        let prevY = this.y;

        // After update:
        if (this.body.velocity.y > 999 && this.body.blocked.down) {
            this.y = Math.min(this.y, prevY); // crude correction
            this.body.velocity.y = 0;
        }

        if (!this.isCrouch) {
            this.lerpHitBox(delta);
        }

        GameManager.location.x = this.x;
        GameManager.location.y = this.y;
    }

    setStats() {
        this.healthMax = GameManager.stats.healthMax ?? 25;
        this.health = GameManager.stats.health ?? 25;
        this.emit('updateHealth', this.health, this.healthMax);
        this.network.socket.emit('updateHealth', this.health, this.healthMax);
    }

    Died(killer) {
        if (this.alive == false) return;
        this.alive = false;

        const deathPenalty = Math.floor(GameManager.power.money);
        this.updateMoney(-deathPenalty);

        if (killer) {
            const data = { killer, money: deathPenalty }
            this.network.socket.emit('pvpKillRequest', data);
        }

        GameManager.stats.health = this.healthMax;

        this.leftSpam = 0;
        this.rightSpam = 0;

        this.setTint(0xff0000); // Flash red
        this.anims?.stop?.(); // Stop any animations

        this.gameOverText = this.scene.add.text(
            this.scene.cameras.main.width / 2,
            this.scene.cameras.main.height / 2,
            'YOU DIED!\n' + deathPenalty + ' Source\n\nR to respawn\nT to go Home', {
            fontSize: '64px',
            color: '#ff0000'
        });

        this.gameOverText.setOrigin(0.5);
        this.gameOverText.setScrollFactor(0);

        this.emit('playerdied');

        GameManager.useLastLocation = false;
        GameManager.save();

        this.spectatePlayer(true);
        this.scene.physics?.pause(); // Stop physics
        // this.scene.time.delayedCall(10000, () => {
        //     //this.scene.scene.restart()
        //     this.gameOverText.destroy();
        //     this.respawnPlayer()
        // });
    }

    spectatePlayer(spectate = false, index = 0) {
        return playerSpectatePlayer(this, spectate, index);
    }

    respawnPlayer() {
        // const respawnLoc = this.scene.tileObjects?.objects.find(obj => obj.name === 'spawnPlayer');
        // this.gameOverText?.destroy();
        // this.setPosition(respawnLoc?.x, respawnLoc?.y)
        // this.setVelocity(0, 0);
        // this.setStats();
        // this.clearTint();
        // this.alive = true;
        // this.scene.setupRaceTimer();
        // this.spectatePlayer(false);
        // this.scene.physics?.resume();
        this.leftWeapon.release();
        this.rightWeapon.release();
        this.setVelocity(0, 0);
        GameManager.useLastLocation = false;
        GameManager.stats.health = 25;
        GameManager.save();
        this.scene.scene.restart()
    }

    // touchWall(player, platform) {
    //     if (this.body.blocked.down) {
    //         this.resetJump();
    //         this.resetDash();
    //     }

    //     if (this.body.blocked.left || this.body.blocked.right) {
    //         this.resetJump(200);
    //         this.wallJumpX = this.body.blocked.left ? 400 : -400;
    //         this.wallJump = true;
    //         this.setMaxVelocity(1000, 50);

    //         console.log('touching wall')

    //         if (this.dashTween) {
    //             this.dashTween.stop();
    //             this.isDashing = false;
    //         }
    //     }
    // }

    touchFireWall(wall) {
        // const tileWorldX = wall.getCenterX();
        // const tileWorldY = wall.getCenterY();
        // const rawDirection = new Phaser.Math.Vector2(this.x - tileWorldX, this.y - tileWorldY);
        // const angle = Phaser.Math.Snap.To(rawDirection.angle(), Phaser.Math.DegToRad(90)); // Snap to 90°
        // const direction = new Phaser.Math.Vector2(Math.cos(angle), Math.sin(angle));
        // this.knockbackVelocity = direction.scale(50);
        // const velocity = direction.scale(600);
        // this.TakeDamage(velocity.x, velocity.y, 5, 300);

        const x = this.body.blocked.left ? 1 : this.body.blocked.right ? -1 : 0;
        const y = this.body.blocked.down ? -1 : this.body.blocked.up ? 1 : 0;
        this.TakeDamage(x * 600, y * 600, 5, 300);


    }

    handleInput(time, delta) {
        return playerHandleInput(this, time, delta);
    }

    decideState(input, delta) {
        return playerDecideState(this, input, delta);
    }

    getInput() {
        return playerGetInput(this);
    }

    setState(newState, input) {
        return playerSetState(this, newState, input);
    }

    walkLerp(delta, a, modify) {
        return playerWalkLerp(this, delta, a, modify);
    }

    setupStates() {
        setupPlayerStates(this);
    }


    updateHealth(value) {
        return playerUpdateHealth(this, value);
    }

    resetJump(dash = true) {
        this.canJump = true;
        this.wallRunLeft = 540;
        this.wallRunRight = 540;
        this.wallJumpLeftMin = 540;
        this.wallJumpRightMin = 540;
        this.reachApex = true;

        if (!dash) return;
        if (this.canResetDash) {
            this.queResetDash = false;
            this.canDash = true;
            this.setTint(this.buffColor);
        } else {
            this.queResetDash = true;
        }
    }

    dashBuff() {
        const prevColor = this.buffColor;

        this.dashSpeed = 2000
        this.dashDuration = 300;
        this.buffColor = 0x0000FF;
        this.setTint(0x0000FF);
        this.resetDash(true);
        this.scene.time.removeEvent(this.dashBuffTimer);
        this.dashBuffTimer = this.scene.time.addEvent({
            delay: 15000,
            callback: () => {
                this.dashSpeed = 900
                this.dashDuration = 250;
                this.buffColor = 0x66ff33;
                this.clearTint();
            }
        })
    }

    lerpHitBox(delta) {
        if (!this.hitBoxSize) return;
        let done = true;

        // Interpolate height
        if (Math.abs(this.hitBoxSize.y - this.baseHitBoxSize.y) > 1) {
            this.hitBoxSize.y = Phaser.Math.Linear(this.hitBoxSize.y, this.baseHitBoxSize.y, delta / 100); // smoothing factor
            this.setSize(115, this.hitBoxSize.y);
            done = false;
        } else {
            this.hitBoxSize.y = this.baseHitBoxSize.y;
            this.setSize(115, this.hitBoxSize.y);
        }

        // Interpolate offset
        if (Math.abs(this.hitBoxSize.yo - this.baseHitBoxSize.yo) > 1) {
            this.hitBoxSize.yo = Phaser.Math.Linear(this.hitBoxSize.yo, this.baseHitBoxSize.yo, delta / 100);
            this.setOffset(70, this.hitBoxSize.yo);
            done = false;
        } else {
            this.hitBoxSize.yo = this.baseHitBoxSize.yo;
            this.setOffset(70, this.hitBoxSize.yo);
        }

        return done;
    }

    animChooser(delta) {
        const state = {
            x: this.x,
            y: this.y,
            f: this.flipX ? 1 : 0,
            a: this.anims?.currentAnim?.key || '',
            c: this.isCrouch ? 1 : 0,
            j: !this.body.blocked.down ? 1 : 0,
            jp: this.isJumping ? 1 : 0,
            s: this.isSliding ? 1 : 0,
            h: this.isHealing ? 1 : 0,
            t: this.stunned ? 1 : 0,
            d: this.isDashing ? 1 : 0,
            w: this.isWalking ? 1 : 0,
            wj: this.wallJumpTimer > (this.scene.time.now - 200) ? 1 : 0,
            wr: this.wallRunning ? 1 : 0,
            ws: this.wallSlide ? 1 : 0,
            slam: this.isSlamming > (this.scene.time.now - 550) ? 1 : 0,
            m: this.isMantling > (this.scene.time.now - 200) ? 1 : 0,
            med: this.isMeditating ? 1 : 0,
            dead: !this.alive ? 1 : 0,

        };
        this.syncGhost(delta, state);

        const { x, y, f, a, c, j, jp, s, h, t, d, w, wj, wr, ws, slam, m, med, dead } = state;


        if (dead) {
            this.stop();
            this.setFrame(22);
            return;
        }

        if (t) {
            this.stop();
            this.setFrame(16);
            return;
        }

        if (wj) {
            this.play('dudetwist', true);
            return;
        }

        if (m) {
            this.play('dudemantle', true);
            return;
        }

        if (ws) {
            this.stop();
            this.setFrame(12);
            return;
        }

        if (wr) {
            this.play('dudeclimb', true);
            return;
        }

        if (d) {
            this.stop();
            this.setFrame(11);
            return;
        }

        if (s && !j) {
            this.stop();
            this.setFrame(9);
            return;
        }

        if (slam) {
            this.stop();
            this.setFrame(15);
            return;
        }

        if (jp) {
            this.play('dudejump');
            return;
        }

        if (c) {
            this.stop();
            this.setFrame(6);
            return;
        }

        if (h) {
            this.stop();
            this.setFrame(10);
            return;
        }


        if (j) {
            this.stop();
            this.setFrame(5);
            return;
        }

        if (med) {
            this.stop();
            this.setFrame(23);
            return;
        }

        if (w) {
            this.play('dudewalk', true);
        } else {
            this.stop();
            this.setFrame(0);
        }
    }

    syncGhost(delta, state) {
        return playerSyncGhost(this, delta, state);
    }

    hasStateChanged(newState, oldState) {
        for (let key in newState) {
            if (newState[key] !== oldState[key]) {
                return true;
            }
        }
        return false;
    }

    TakeDamage(x, y, damage = 1, stunDuration = 300, actor) {
        return playerTakeDamage(this, x, y, damage, stunDuration, actor);
    }

    adjustHealth(amount) {
        return playerAdjustHealth(this, amount);
    }

    resetDash(force = false) {
        if ((this.canResetDash && !this.stunned) || force) {
            this.queResetDash = false;
            this.canDash = true;
            this.setTint(this.buffColor);
        } else {
            this.queResetDash = true;
        }
    }

    PickupItem(money = 0) {
        if (money > 0) {
            this.updateMoney(money);
        }
    }

    updateMoney(money = 0) {
        const intMoney = Math.floor(money);
        const prevMoney = GameManager.power.money;
        GameManager.power.money = Math.max(0, GameManager.power.money + intMoney);
        GameManager.save();
        this.network.socket.emit('playerLevel', GameManager.power);
        this.emit('moneyChanged', intMoney);
    }

    getMoney() {
        return GameManager.power.money;
    }

    setupAnimation() {
        if (!this.scene.anims.get('dudewalk')) {
            this.scene.anims.create({
                key: 'dudewalk',
                frames: this.anims.generateFrameNumbers('dudesheet', { start: 2, end: 4 }),
                frameRate: 10,
                repeat: -1,
            });
        }

        if (!this.scene.anims.get('dudecrouch')) {
            this.scene.anims.create({
                key: 'dudecrouch',
                frames: this.anims.generateFrameNumbers('dudesheet', { start: 6, end: 8 }),
                frameRate: 8,
                repeat: -1,
            });
        }

        if (!this.scene.anims.get('dudeclimb')) {
            this.scene.anims.create({
                key: 'dudeclimb',
                frames: this.anims.generateFrameNumbers('dudesheet', { start: 12, end: 14 }),
                frameRate: 11,
                yoyo: true,
                repeat: -1,
            });
        }

        if (!this.scene.anims.get('dudemantle')) {
            this.scene.anims.create({
                key: 'dudemantle',
                frames: [
                    { key: 'dudesheet', frame: 16, duration: 50 },
                    { key: 'dudesheet', frame: 17, duration: 100 },
                    { key: 'dudesheet', frame: 16, duration: 50 },
                ],
            });
        }
        if (!this.scene.anims.get('dudejump')) {
            this.scene.anims.create({
                key: 'dudejump',
                frames: [
                    { key: 'dudesheet', frame: 7, duration: 100 },
                    { key: 'dudesheet', frame: 2, duration: 100 },
                    { key: 'dudesheet', frame: 5, duration: 100 },
                ],
            });
        }
        if (!this.scene.anims.get('dudetwist')) {
            this.scene.anims.create({
                key: 'dudetwist',
                duration: 200,
                frames: [
                    { key: 'dudesheet', frame: 17 },
                    { key: 'dudesheet', frame: 18 },
                    { key: 'dudesheet', frame: 19 },
                    { key: 'dudesheet', frame: 20 },
                    { key: 'dudesheet', frame: 21 },
                ],
            });
        }


    }

    syncNetwork() {
        return playerSyncNetwork(this);
    }

    equipWeapon(name = 'Shurikan', slot = 0,) {
        let equippedWeapon;
        if (slot === 0) {
            this.leftWeapon = createWeapon(name, this.scene, this);
            equippedWeapon = this.leftWeapon;
            GameManager.weapons.left = name;
        } else if (slot === 1) {
            this.rightWeapon = createWeapon(name, this.scene, this);
            equippedWeapon = this.rightWeapon;
            GameManager.weapons.right = name;
        } else {
            this.aura = createWeapon(name, this.scene, this);
            equippedWeapon = this.aura;
            GameManager.weapons.aura = name;
        }
        if (this.playerUI) {
            this.playerUI.setWeaponIcon(name, slot);
        }
        GameManager.save();
        return equippedWeapon;
    }

    getCurrentPos() {
        return new Phaser.Math.Vector2(this.x, this.y);
    }

    makeChatBubble(message) {
        if (!this.chatBubble) {
            this.chatBubble = new ChatBubble(this.scene, this.x, this.y - 100, message);
        } else {
            this.chatBubble.updateMessage(message, this.scene);
        }
        this.network.socket.emit('playerchatRequest', message)
    }

    makeScreenFlash() {
        const cam = this.scene.cameras.main;
        const screenFlash = this.scene.add.image(cam.centerX, cam.centerY, 'damagescreenflash').setScrollFactor(0).setOrigin(.5);
        screenFlash.setDisplaySize(cam.displayWidth, cam.displayHeight);

        this.scene.add.tween({
            targets: screenFlash,
            alpha: 0,
            duration: 400,
            onComplete: () => {
                if (!this.alive) return;
                screenFlash.destroy();
            },
        })
    }

    tryUncrouch() {
        if (!this.isCrouch) {
            return;
        }
        const body = this.body;
        const buffer = 36; // extra safety padding

        // Coordinates at top-left and top-right just above the player
        const leftX = body.x + buffer;
        const rightX = body.right - buffer;
        const checkY = body.y - 25; // just above the head

        const tileLeft = this.scene.walls?.hasTileAtWorldXY(leftX, checkY);
        const tileRight = this.scene.walls?.hasTileAtWorldXY(rightX, checkY);

        if (!tileLeft && !tileRight) {
            this.uncrouch(); // safe to stand
        } else {
            // blocked, do nothing or stay crouched
        }
    }

    uncrouch() {
        if (!this.isCrouch) {
            return;
        }

        this.isCrouch = false;

        // const oldHeight = this.body.height;
        // const newHeight = this.baseHitBoxSize.y;
        // const heightDifference = newHeight - oldHeight;

        // // Shift body up to keep feet fixed
        // this.body.y -= heightDifference;

        // this.setSize(115, newHeight);
        // this.setOffset(70, this.baseHitBoxSize.yo);

        // // Force immediate collision resolution with the floor
        // this.scene.physics.world.collide(this, this.scene.walls);

        // this.body.updateFromGameObject();
    }

    hitLaser(hit) {
        const dirX = this.x - hit.x;
        const dirY = this.y - hit.y;
        this.TakeDamage(dirX, dirY, 1, 0);
    }

}