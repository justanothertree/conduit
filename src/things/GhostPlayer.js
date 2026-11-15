import { changeCollision } from "../myFunctions.js";
import AuraSprite from "../weapons/auraSprite.js";
import ShurikanProjectile from "../weapons/shurikanProjectile.js";
import ZapSprite from "../weapons/zapSprite.js";
import ChatBubble from "./chatBubble.js";
import { getRank } from "./RankSystem.js";

export default class GhostPlayer extends Phaser.GameObjects.Container {
  constructor(scene, id, data = {
    location: { x: 0, y: 0 },
    name: { text: 'Hunter', color: '#ffffff' },
    power: { money: 0, auraLevel: 1 },
  }) {
    super(scene, data.location.x, data.location.y);

    const { location, name, power, stats } = data;
    this.id = id;
    this.myData = data;
    this.money = power.money;
    this.auraLevel = power.auraLevel;
    this.nameText = name.text;
    this.nameColor = name.color;
    this.healthMax = stats.healthMax;
    this.health = stats.health;

    this.prevPos = new Phaser.Math.Vector2(location.x, location.y);
    this.targetPos = new Phaser.Math.Vector2(location.x, location.y);
    this.lerpTimer = 0;
    this.lerpDuration = 15;

    // Add the container itself to the scene's display list
    scene.add.existing(this);

    if (scene.spawnManager.pvpGroup) {
      scene.spawnManager.pvpGroup.add(this);
    }

    changeCollision(this, 40, 90, 0, 0);

    this.setDepth(8);

    this.createVisuals();
  }

  preUpdate(time, delta) {
    this.lerpPosition(delta);
  }

  createVisuals() {
    // Add auraSprite as a child of the container
    this.auraSprite = new AuraSprite(this.scene, 0, 0, this.auraLevel) // Position (0,0) is container's center
      .setTint(0x00ffff);
    this.auraSprite.setDepth(0); // Lower depth than sprite
    this.add(this.auraSprite);

    // Add sprite as a child of the container
    this.sprite = this.scene.add.sprite(0, 0, 'dudesheet'); // Position (0,0) is container's center
    this.sprite.setScale(0.35);
    this.sprite.setAlpha(0.6);
    this.baseTint = '0x00ffff';
    this.sprite.setTint(0x00ffff);
    this.sprite.setOrigin(0.5, 0.5); // Center the sprite on the container's origin
    this.sprite.setDepth(1); // Higher depth than aura
    this.add(this.sprite);

    const spriteHeight = this.sprite.displayHeight;

    // Add moneyText as a child of the container
    this.moneyText = this.scene.add.text(0, -spriteHeight, getRank(this.money) + '\n' + this.money, {
      fontSize: '12px',
      align: 'center',
      fill: '#00FFFF'
    }).setOrigin(0.5).setDepth(2); // Higher depth than sprite
    this.add(this.moneyText);

    // Add headName as a child of the container
    this.headName = this.scene.add.text(0, -spriteHeight / 1.25, this.nameText, {
      fontSize: '12px',
      align: 'center',
      fill: this.nameColor,
      shadow: {
        offsetX: -1,
        offsetY: 1,
        color: '#222222',
        blur: true,
        stroke: true,
      }
    }).setOrigin(0.5).setDepth(2); // Same depth as money text
    this.add(this.headName);

    // Initialize healthBar graphics object, but don't draw it until updateHealth
    this.healthBar = this.scene.add.graphics();
    this.healthBar.setDepth(3); // Highest depth for now
    this.add(this.healthBar);
  }

  TakeDamage(x, y, damage = 1, stunDuration = 300) {
    const id = this.id;
    const data = { x, y, damage, stunDuration, id };
    this.scene.network.socket.emit('pvpDamageRequest', (data));
  }

  lerpPosition(delta) {
    if (!this.sprite) return;

    this.lerpTimer += delta;

    const t = Phaser.Math.Clamp(this.lerpTimer / this.lerpDuration, 0, 1);
    const lerpedX = Phaser.Math.Linear(this.prevPos.x, this.targetPos.x, t);
    const lerpedY = Phaser.Math.Linear(this.prevPos.y, this.targetPos.y, t);

    this.x = lerpedX;
    this.y = lerpedY;

  }

  setGhostState(state) {
    if (!this.sprite) return;
    const { x, y, f, a, c, j, jp, s, h, t, d, w, wj, wr, ws, slam, m, med, dead } = state;
    if (this.prevX === undefined) {
      this.prevX = x;
      this.prevY = y;
    }
    const epsilon = .5;

    this.xv = x - this.prevX;
    this.yv = y - this.prevY;

    if (Math.abs(this.xv) < epsilon) this.xv = 0;
    if (Math.abs(this.yv) < epsilon) this.yv = 0;

    this.prevX = x;
    this.prevY = y;
    this.lerpTimer = 0;
    this.prevPos.set(this.x, this.y);
    this.targetPos.set(x, y);

    this.sprite.flipX = f;


    if (dead) {
      this.sprite.setTint('0xFF0000');
      this.sprite.stop();
      this.sprite.setFrame(22);
      return;
    } else {
      this.sprite.setTint(this.baseTint);
    }

    if (t) {
      this.sprite.setTint('0xFF0000');
      this.sprite.stop();
      this.sprite.setFrame(16);
      return;
    } else {
      this.sprite.setTint(this.baseTint);
    }

    if (wj) {
      this.sprite.play('dudetwist', true);
      return;
    }

    if (m) {
      this.sprite.play('dudemantle', true);
      return;
    }

    if (ws) {
      this.sprite.stop();
      this.sprite.setFrame(12);
      return;
    }

    if (wr) {
      this.sprite.play('dudeclimb', true);
      return;
    }

    if (d) {
      this.sprite.stop();
      this.sprite.setFrame(11);
      return;
    }

    if (s && !j) {
      this.sprite.stop();
      this.sprite.setFrame(9);
      return;
    }

    if (slam) {
      this.sprite.stop();
      this.sprite.setFrame(15);
      return;
    }

    if (jp) {
      this.sprite.play('dudejump', true);
      return;
    }

    if (c) {
      this.sprite.stop();
      this.sprite.setFrame(6);
      return;
    }

    if (h) {
      this.sprite.stop();
      this.sprite.setFrame(10);
      return;
    }


    if (j) {
      this.sprite.stop();
      this.sprite.setFrame(5);
      return;
    }

    if (med) {
      this.sprite.stop();
      this.sprite.setFrame(23);
      if (!this.meditateEmitter) {
        this.meditateEmitter = this.scene.add.particles(this.x, this.y, 'greenFlame', {
          speed: 100,
          lifespan: 500,
          alpha: .2,
          scale: { start: 1, end: 0 },
          blendMode: 'ADD',
        });
        this.meditateEmitter.setDepth(7);
      } else {
        this.meditateEmitter.setPosition(this.x, this.y)
        this.meditateEmitter.start();
      }
      return;
    } else {
      this.meditateEmitter?.stop();
    }

    if (w) {
      this.sprite.play('dudewalk', true);
    } else {
      this.sprite.stop();
      this.sprite.setFrame(0);
    }


  }

  updateName(text, color) {
    this.nameColor = color;
    this.nameText = text;
    this.headName.setText(this.nameText);
    this.headName.setColor(this.nameColor);
  }

  updateHealth(health, max) {
    this.currentHealth = health;
    this.maxHealth = max;

    const percentHealth = Phaser.Math.Clamp(health / max, 0, 1);

    // Ensure health bar exists, it should be created in createVisuals
    if (!this.healthBar) {
      this.healthBar = this.scene.add.graphics().setDepth(3);
      this.add(this.healthBar);
    }

    this.healthBar.clear();

    const spriteHeight = this.sprite.displayHeight / 1.5;
    const healthBarHeight = 5;
    const healthBarWidth = 50;

    // Calculate Y position relative to headName
    const healthBarY = -spriteHeight;
    const healthBarX = -healthBarWidth / 2; // Centered

    // Background
    this.healthBar.fillStyle(0x000000, 0.8);
    this.healthBar.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    // Foreground
    this.healthBar.fillStyle(0x00FF00, 1);
    this.healthBar.fillRect(healthBarX, healthBarY, healthBarWidth * percentHealth, healthBarHeight);
  }

  updatePower(money, auraLevel) {
    this.money = money;
    this.auraLevel = auraLevel;
    this.auraSprite.setAuraLevel(this.auraLevel);
    this.moneyText.setText(getRank(this.money) + '\n' + this.money);
  }

  syncAll(data) {
    this.myData = data;
    const location = this.myData.location || { x: 0, y: 0 };
    const power = this.myData.power || { money: 0, auraLevel: 1 };
    const name = this.myData.name || { text: 'Hunter', color: '#FFFFFF' };

    this.updateName(name.text, name.color);
    this.updatePower(power.money, power.auraLevel);

    this.x = location.x;
    this.y = location.y;
  }

  getSyncData() {
    return {
      data: this.myData
    };
  }


  destroy() {
    // Ghost attack FX live on the scene (not on this container) and
    // self-destroy on a timer — but a player leaving mid-swing must not
    // leave a stale sprite behind, so destroy any still tracked here.
    // A ZapSprite's own deactivate timer is removed first: it would
    // otherwise fire after the sprite is destroyed.
    if (this._ghostFx?.length) {
      for (const fx of this._ghostFx) {
        if (!fx) continue;
        if (fx.deactivateTimer) this.scene?.time?.removeEvent(fx.deactivateTimer);
        if (fx.active) fx.destroy();
      }
      this._ghostFx = [];
    }
    if (this.meditateEmitter) {
      this.meditateEmitter.stop();
      this.meditateEmitter.destroy();
    }
    super.destroy();
  }

  // --- Ghost attack visuals (Part 1, display-only) -----------------------
  // Every method renders another player's attack at ~0.5 alpha, never
  // joins weaponGroup or any attackable overlap, never deals damage, and
  // destroys itself after its duration. Anim keys are created here if the
  // local player never equipped the weapon (anims are per-scene, and the
  // weapon constructors only create them for the owner).
  _trackGhostFx(obj) {
    (this._ghostFx ??= []).push(obj);
    return obj;
  }

  _destroyGhostFx(obj) {
    if (!obj) return;
    if (obj.deactivateTimer) this.scene?.time?.removeEvent(obj.deactivateTimer);
    if (obj.active) obj.destroy();
    const i = this._ghostFx?.indexOf(obj);
    if (i >= 0) this._ghostFx.splice(i, 1);
  }

  _destroyGhostFxAfter(obj, ms) {
    this.scene.time.delayedCall(ms, () => this._destroyGhostFx(obj));
  }

  _ensureGhostAnim(key, create) {
    if (!this.scene.anims.get(key)) create();
  }

  ghostSword({ start, direction, angle, wave }) {
    const scene = this.scene;
    if (!scene?.anims) return;
    this._ensureGhostAnim('sword', () => scene.anims.create({
      key: 'sword',
      defaultTextureKey: 'sword',
      duration: 300,
      frames: [{ frame: 0 }, { frame: 1 }, { frame: 2 }, { frame: 2 }, { frame: 3 }, { frame: 4 }, { frame: 5 }],
    }));
    // Local sword sits 70px out from the player along the aim direction.
    const x = start.x + direction.x * 70;
    const y = start.y + direction.y * 70;
    const sword = scene.add.sprite(x, y, 'sword')
      .setScale(0.24).setAngle(angle).setDepth(101).setAlpha(0.5);
    sword.play('sword');
    sword.setFlipY(angle > 90 || angle < -90);
    this._trackGhostFx(sword);
    this._destroyGhostFxAfter(sword, 300);

    if (wave) {
      // A real SwordWave is a WeaponProjectile (weaponGroup + damage), so
      // the ghost wave is a plain sprite tweened along the aim line at
      // the real wave's 400 px/s for its 600ms life — no physics, no hit.
      this._ensureGhostAnim('swordwave', () => scene.anims.create({
        key: 'swordwave',
        defaultTextureKey: 'swordwave',
        duration: 200,
        repeat: -1,
        frames: [{ frame: 0 }, { frame: 1 }],
      }));
      const waveSprite = scene.add.sprite(x, y, 'swordwave')
        .setScale(0.11).setAngle(angle).setDepth(101).setAlpha(0.5);
      waveSprite.play('swordwave');
      waveSprite.setFlipY(angle > 90 || angle < -90);
      this._trackGhostFx(waveSprite);
      scene.tweens.add({
        targets: waveSprite,
        x: x + direction.x * 240,
        y: y + direction.y * 240,
        duration: 600,
        ease: 'Linear',
      });
      this._destroyGhostFxAfter(waveSprite, 600);
    }
  }

  ghostWhip({ start, direction, angle }) {
    const scene = this.scene;
    if (!scene?.anims) return;
    this._ensureGhostAnim('whip', () => scene.anims.create({
      key: 'whip',
      defaultTextureKey: 'whip',
      duration: 150,
      frames: [{ frame: 0 }, { frame: 1 }, { frame: 2 }, { frame: 3 }, { frame: 4 }],
    }));
    // Local whip sits 15px out along the aim direction; the grapple that
    // follows is movement, not an attack visual, so the ghost shows only
    // the 250ms flick.
    const whip = scene.add.sprite(start.x + direction.x * 15, start.y + direction.y * 15, 'whip')
      .setScale(0.48).setOrigin(0, 0.5).setAngle(angle).setDepth(101).setAlpha(0.5);
    whip.play('whip');
    whip.setFlipY(angle > 90 || angle < -90);
    this._trackGhostFx(whip);
    this._destroyGhostFxAfter(whip, 250);
  }

  ghostDarkOrb({ start, velocity }) {
    const scene = this.scene;
    if (!scene?.anims) return;
    this._ensureGhostAnim('darkorb', () => scene.anims.create({
      key: 'darkorb',
      frames: scene.anims.generateFrameNumbers('darkorb', { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    }));
    // A real DarkOrbProjectile needs a pointer (its preUpdate steers
    // toward it every frame) and joins weaponGroup with a damage tick, so
    // the ghost orb is a plain sprite tweened straight ahead instead:
    // the real orb steers at 200 px/s, so 2.5s of flight is 500px.
    const orb = scene.add.sprite(start.x, start.y, 'darkorb')
      .setScale(0.35).setDepth(101).setAlpha(0.5);
    orb.play('darkorb');
    this._trackGhostFx(orb);
    const len = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) || 1;
    scene.tweens.add({
      targets: orb,
      x: start.x + (velocity.x / len) * 500,
      y: start.y + (velocity.y / len) * 500,
      duration: 2500,
      ease: 'Linear',
    });
    scene.tweens.add({ targets: orb, angle: 360, duration: 2000, repeat: -1, ease: 'Linear' });
    scene.tweens.add({ targets: orb, scaleX: 0.45, scaleY: 0.45, duration: 2500, ease: 'Linear' });
    // Match the real orb's 2.5s lifetime, then fade out instead of
    // detonating (no detonation event in Part 1).
    scene.time.delayedCall(2500, () => {
      if (!orb.active) return;
      scene.tweens.add({
        targets: orb,
        alpha: 0,
        duration: 200,
        ease: 'Linear',
        onComplete: () => this._destroyGhostFx(orb),
      });
    });
  }

  ghostAuraZap({ target }) {
    const scene = this.scene;
    if (!scene) return;
    // ZapSprite draws a line from a player to a target object; the ghost
    // passes a plain {x, y, active: true} endpoint — the remote target
    // may not exist on this client, so coordinates are all we send.
    // Its own 200ms deactivate timer is replaced by our destroy timer
    // (deactivate only hides; the ghost sprite must be destroyed).
    const fakeTarget = { x: target.x, y: target.y, active: true };
    const zap = new ZapSprite(scene, this.x, this.y, this, fakeTarget);
    zap.setAlpha(0.5);
    zap.setDepth(101);
    zap.init(this, fakeTarget);
    if (zap.deactivateTimer) scene.time.removeEvent(zap.deactivateTimer);
    this._trackGhostFx(zap);
    this._destroyGhostFxAfter(zap, 220);
  }

  ghostShurikan(shotInfo) {
    if (!shotInfo || typeof shotInfo !== 'object') return;
    const { start, direction } = shotInfo;
    // Untrusted network data: drop a malformed throw instead of spawning
    // a NaN-velocity projectile or throwing here.
    if (!start || !direction || !Number.isFinite(start.x) || !Number.isFinite(start.y)
      || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return;
    const speed = 1000;

    // Chain jumps: the sender's chain count rides the throw (capped 0-5);
    // the ghost projectile chains against THIS client's local enemies via
    // the visual-only path in ShurikanProjectile.enemyHit.
    const chain = Number.isInteger(shotInfo.chain)
      ? Phaser.Math.Clamp(shotInfo.chain, 0, 5) : 0;
    const targets = Number.isInteger(shotInfo.targets)
      ? Phaser.Math.Clamp(shotInfo.targets, 1, 3) : 3;

    // Scalar multiply — no per-shot Vector2 allocation (same pattern as
    // the projectile enemyHit paths). setVelocity only reads the numbers.
    const shurikan = new ShurikanProjectile(this.scene, start.x, start.y, this.scene.player, null, chain, 1, targets, true);
    shurikan.setVelocity(direction.x * speed, direction.y * speed);
    shurikan.setAlpha(.5);
    // Multishot fan: the sender includes the extra velocities, so the
    // whole fan renders — visual-only, like the main ghost shurikan.
    // Senders without the field (stale builds) send none.
    // Extras are untrusted network data (another player's client sends
    // them): cap at 3 and drop anything that isn't a finite x/y pair, so
    // a malformed fan can't throw here or spawn NaN-velocity projectiles.
    const extras = Array.isArray(shotInfo.extras) ? shotInfo.extras.slice(0, 3) : [];
    for (const ev of extras) {
      if (!ev || !Number.isFinite(ev.x) || !Number.isFinite(ev.y)) continue;
      const extra = new ShurikanProjectile(this.scene, start.x, start.y, this.scene.player, null, chain, 1, targets, true);
      extra.setVelocity(ev.x, ev.y);
      extra.setAlpha(.5);
    }
  }

  makeChatBubble(message) {
    if (!this.chatBubble) {
      this.chatBubble = new ChatBubble(this.scene, 0, -this.sprite.displayHeight / 2 - 60, message);
      this.add(this.chatBubble); // Add chat bubble as a child
      this.chatBubble.setDepth(4);
    } else {
      this.chatBubble.updateMessage(message, this.scene);
    }
  }
}