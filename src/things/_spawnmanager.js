import BaseEnemy from "./_baseEnemy.js";
import Bullet from "./bullet.js"
import Duck from "./enemyDuck.js"
import Bat from "./enemyBat.js"
import Boss from "./enemyBoss.js"
import Boss2 from "./enemyBoss2.js"
import Checkpoint from "./checkpoint.js"
import Turret from "./enemyTurret.js"
import Charger from "./enemyCharger.js"
import Bomber from "./enemyBomber.js"
import Miniboss from "./enemyMiniboss.js"
import Swarmer from "./enemySwarmer.js";
import Spitter from "./enemySpitter.js";
import SunMan from "./enemySunman.js";
import Coin from "./coin.js";
import Booster from "./booster.js";
import DashBuff from "./dashBuff.js";
import { getProperty } from "../myFunctions.js";
import Portal from "./portal.js";
import FinishLine from "./finishLine.js";
import LaserSprite from "../weapons/laserSprite.js";
import CardPickup from "./cardPickup.js";
import Shard from "./shard.js";
import GameManager from "./GameManager.js";

export default class SpawnManager {
    static instance;
    constructor(scene, player) {
        SpawnManager.instance = this;
        this.scene = scene;
        this.player = player;
        this.sceneKey = scene.scene.key;
        this.enemyCounter = 0;
        // Part 2 — scene-level netId → enemy registry. Built at spawn
        // time (registerNetEnemy), read by the host's broadcast tick
        // and by the client's state-apply path. Scene-scoped: a new
        // scene gets a new SpawnManager, so no stale cross-scene ids.
        this.netEnemies = new Map();
    }

    // Stable enemy identity (Part 2): the netId derives from the spawn
    // point, so respawns at the same point get the same id on every
    // client and pooled reuse at a different point gets that point's
    // id. Assign on EVERY spawn/activation, never on construction —
    // the constructor doesn't know the spawn point. Also stamps
    // isRemote (spawn functions pass it through) and netType, the
    // canonical lowercase wire type. netIdOverride is the host's id
    // for a puppet (spawnRemote): a re-activated enemy must keep the
    // host's id, NOT derive one from its current position — it has
    // moved since it spawned, and a derived id would disagree with
    // the host and duplicate the puppet. The previous key for the
    // same enemy is dropped first, or one pooled enemy would
    // broadcast twice (once per key).
    registerNetEnemy(enemy, type, x, y, isRemote = false, netIdOverride = null) {
        if (!enemy) return null;
        if (enemy.netId && this.netEnemies.get(enemy.netId) === enemy) {
            this.netEnemies.delete(enemy.netId);
        }
        const netId = netIdOverride ?? `${type}:${Math.round(x)}:${Math.round(y)}`;
        enemy.netId = netId;
        enemy.netType = type;
        if (!enemy.name) enemy.name = type;
        // The remote flag routes through setRemote, never a direct
        // write: a direct write left fresh puppets with gravity on
        // and the 33ms lerp (applyEnemyState's `if (!enemy.isRemote)
        // setRemote(true)` saw the flag already set and skipped the
        // setup), and left ex-puppets respawned locally with puppet
        // setup still parked. Bat/sunman spawns call setRemote
        // before init() (init needs the flag for its homing
        // decision); every other spawn funnels through here, so this
        // is where their transition runs.
        if (isRemote) enemy.setRemote(true);
        else if (enemy.isRemote) enemy.setRemote(false);
        this.netEnemies.set(netId, enemy);
        return enemy;
    }

    // Spawn (or re-activate from the pool) a remote puppet for a host
    // state entry whose netId has no live local enemy. Routes through
    // the normal spawn functions with isRemote=true, so pooled reuse,
    // hitboxes and init all behave — only the AI stays off (see
    // BaseEnemy.setRemote / the per-class preUpdate gates). The host's
    // netId is threaded through as `id` so the puppet registers under
    // exactly the id the host broadcasts.
    spawnRemote(type, x, y, hp, netId = null) {
        switch (type) {
            case 'duck': return this.spawnDuck(x, y, null, hp, true, netId);
            case 'bat': return this.spawnBat(x, y, null, hp, true, netId);
            case 'sunman': return this.spawnSunMan(x, y, null, hp, true, netId);
            case 'turret': return this.spawnTurret(x, y, null, hp, true, netId);
            case 'charger': return this.spawnCharger(x, y, null, hp, true, netId);
            case 'bomber': return this.spawnBomber(x, y, null, hp, true, netId);
            case 'spitter': return this.spawnSpitter(x, y, null, hp, true, netId);
            // Swarmers are one tilemap object for THREE enemies: a pack
            // spawn centered on a member's current position would give
            // the siblings wrong ids. Spawn one member, under the
            // entry's exact netId, per host entry instead.
            case 'swarmer': return this.spawnSwarmerMember(netId, x, y, hp);
            case 'boss': return this.spawnBoss(x, y, null, true, netId);
            case 'boss2': return this.spawnBoss2(x, y, null, true, netId);
            case 'miniboss': return this.spawnMiniboss(x, y, null, true, netId);
            default: return null;
        }
    }

    // One swarmer pack member, for the remote path only (see
    // spawnRemote): the local tilemap path still uses spawnSwarmer's
    // pack of three.
    spawnSwarmerMember(netId, x, y, hp = 3) {
        let swarmer = this.swarmerGroup.getFirst(false);
        if (swarmer && swarmer.activate(x, y, hp)) {
            swarmer.init();
        } else {
            swarmer = new Swarmer(this.scene, x, y, hp);
            this.swarmerGroup.add(swarmer);
            swarmer.activate(x, y, hp);
            swarmer.init();
        }
        return this.registerNetEnemy(swarmer, 'swarmer', x, y, true, netId);
    }

    setupGroups(scene) {
        this.batGroup = this.scene.physics.add.group({
            classType: Bat,
            allowGravity: false,
            bounce: .9,
        });
        this.sunmanGroup = this.scene.physics.add.group({
            classType: SunMan,
            runChildUpdate: true,
            allowGravity: false,
        });
        this.duckGroup = this.scene.physics.add.group({
            classType: Duck,
        });
        this.bossGroup = this.scene.physics.add.group({
            classType: Boss,
        });
        this.boss2Group = this.scene.physics.add.group({
            classType: Boss2,
        });
        this.turretGroup = this.scene.physics.add.group({
            classType: Turret,
            allowGravity: false,
            immovable: true,
        });
        this.chargerGroup = this.scene.physics.add.group({
            classType: Charger,
        });
        this.bomberGroup = this.scene.physics.add.group({
            classType: Bomber,
            allowGravity: false,
        });
        this.minibossGroup = this.scene.physics.add.group({
            classType: Miniboss,
            allowGravity: false,
        });
        this.swarmerGroup = this.scene.physics.add.group({
            classType: Swarmer,
        });
        this.spitterGroup = this.scene.physics.add.group({
            classType: Spitter,
        });
        this.bulletGroup = this.scene.physics.add.group({ allowGravity: false });
        this.softBulletGroup = this.scene.physics.add.group({ allowGravity: false });
        this.itemGroup = this.scene.physics.add.group();
        this.cardGroup = this.scene.physics.add.group();
        this.staticItemGroup = this.scene.physics.add.group({ allowGravity: false, immovable: true });
        this.pvpGroup = this.scene.physics.add.group({ allowGravity: false, immovable: true });
        this.pvpGroup.name = 'pvpGroup';

        scene.physics.add.collider(this.sunmanGroup, this.sunmanGroup);
    }

    getGroups() {
        return [
            { group: this.batGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.sunmanGroup, handler: 'enemyHit', zap: true, walls: false },
            { group: this.duckGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.bossGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.boss2Group, handler: 'enemyHit', zap: true, walls: true },
            { group: this.turretGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.chargerGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.bomberGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.swarmerGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.spitterGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.minibossGroup, handler: 'enemyHit', zap: true, walls: true },
            { group: this.bulletGroup, handler: 'bulletHit', zap: false, walls: false },
            { group: this.softBulletGroup, handler: 'bulletHit', zap: false, walls: false },
            { group: this.itemGroup, handler: 'itemHit', zap: false, walls: true },
            { group: this.cardGroup, handler: 'itemHit', zap: false, walls: true },
            { group: this.staticItemGroup, handler: 'itemHit', zap: false, walls: false },
            { group: this.pvpGroup, handler: 'enemyHit', zap: false, walls: false },
        ];
    }

    spawnBat(x, y, obj, health, isRemote = false, id = null) {
        let bat = this.batGroup.getFirst(false);

        if (bat && bat.activate(x, y, health)) {
            // isRemote must be set BEFORE init(): init() only starts
            // the homing timer for local enemies. Route through
            // setRemote, not a direct write — a direct write leaves
            // the puppet setup (gravity parked, 90ms lerp, AI off)
            // unrun, and registerNetEnemy below would early-return
            // on the already-set flag (see registerNetEnemy).
            bat.setRemote(isRemote);
            bat.init();
            return this.registerNetEnemy(bat, 'bat', x, y, isRemote, id);
        }
        // Create new if no usable bat
        bat = new Bat(this.scene, x, y, health);
        this.batGroup.add(bat);
        bat.setRemote(isRemote);
        bat.init();
        return this.registerNetEnemy(bat, 'bat', x, y, isRemote, id);
    }

    spawnSunMan(x, y, obj, health = 3, isRemote = false, id = null) {
        let sunMan = this.sunmanGroup.getFirstDead(false);

        if (sunMan && sunMan.activate(x, y, health)) {
            // setRemote, not a direct write — see spawnBat: the flag
            // must be set before init(), and the puppet setup must
            // actually run.
            sunMan.setRemote(isRemote);
            sunMan.init();
            return this.registerNetEnemy(sunMan, 'sunman', x, y, isRemote, id);
        }

        // Create new if no usable bat
        sunMan = new SunMan(this.scene, x, y, health);
        this.sunmanGroup.add(sunMan);
        sunMan.setRemote(isRemote);
        sunMan.init();
        return this.registerNetEnemy(sunMan, 'sunman', x, y, isRemote, id);
    }


    spawnDuck(x, y, obj, health = 20, isRemote = false, id = null) {
        let duck = this.duckGroup.get(x, y);
        if (duck) {
            if (!duck.activate(x, y, health)) {
                duck = this.duckGroup.create();
                duck.activate(x, y, health);
            }
        }
        this.respawn(duck, x, y, health, this.spawnDuck.bind(this))
        if (duck) this.registerNetEnemy(duck, 'duck', x, y, isRemote, id);

        return duck;
    }

    // Flowline boss: Conduit's first real boss (Boss class, 2-3 attack phases).
    // A per-run set piece guarding the arena — unlike regular ducks it does
    // not respawn.
    spawnBoss(x, y, obj, isRemote = false, id = null) {
        const props = getProperty(obj);
        const health = props?.health ?? Boss.MAX_HEALTH;
        // Rematch: after the first kill the bounty flag is set, so any
        // later spawn (level re-entry, or the arena re-entry trigger
        // armed in die()) is hard mode — faster volleys, faster bullets.
        const rematch = !!GameManager.flags.bossRewardPaid;
        let boss = this.bossGroup.get(x, y);
        if (boss) {
            if (!boss.activate(x, y, health, rematch)) {
                boss = this.bossGroup.create();
                boss.activate(x, y, health, rematch);
            }
        }
        return this.registerNetEnemy(boss, 'boss', x, y, isRemote, id);
    }

    // World 1 boss: the Iron Warden (Boss2 class, 3 distinct phases —
    // sweep rows / burst+ring / pinwheel+slam). A per-run set piece
    // guarding the World 1 arena — unlike regular ducks it does not
    // respawn.
    spawnBoss2(x, y, obj, isRemote = false, id = null) {
        const props = getProperty(obj);
        const health = props?.health ?? Boss2.MAX_HEALTH;
        // Rematch: after the first kill the bounty flag is set, so any
        // later spawn (level re-entry, or the arena re-entry trigger
        // armed in die()) is hard mode — faster volleys, faster bullets.
        const rematch = !!GameManager.flags.boss2RewardPaid;
        let boss = this.boss2Group.get(x, y);
        if (boss) {
            if (!boss.activate(x, y, health, rematch)) {
                boss = this.boss2Group.create();
                boss.activate(x, y, health, rematch);
            }
        }
        return this.registerNetEnemy(boss, 'boss2', x, y, isRemote, id);
    }

    // World 1 mini-boss: the Bombardier (Miniboss class, 2 phases —
    // bomb spreads, then aimed fans). A per-run set piece guarding the
    // antechamber before the Iron Warden — unlike regular bombers it does
    // not respawn.
    spawnMiniboss(x, y, obj, isRemote = false, id = null) {
        const props = getProperty(obj);
        const health = props?.health ?? Miniboss.MAX_HEALTH;
        // Rematch: after the first kill the bounty flag is set, so any
        // later spawn (level re-entry, or the arena re-entry trigger
        // armed in die()) is hard mode — faster attacks, faster bullets.
        const rematch = !!GameManager.flags.minibossRewardPaid;
        let boss = this.minibossGroup.get(x, y);
        if (boss) {
            if (!boss.activate(x, y, health, rematch)) {
                boss = this.minibossGroup.create();
                boss.activate(x, y, health, rematch);
            }
        }
        return this.registerNetEnemy(boss, 'miniboss', x, y, isRemote, id);
    }

    // World 1 checkpoint marker: records a per-run respawn point
    // (Checkpoint class). Static markers — recreated on every scene
    // create, no pooling.
    spawnCheckpoint(x, y, obj) {
        const props = getProperty(obj);
        new Checkpoint(this.scene, x, y, props?.index ?? 0);
    }

    spawnCoin(x, y, obj) {
        const coin = new Coin(this.scene, x, y);
        const props = getProperty(obj);

        this.itemGroup.add(coin);
        coin.setMaxVelocity(800, 800);
        coin.setBounce(.99);
        coin.setScale(.2);
        this.scene.tweens.add({
            targets: coin,
            angle: 360,
            duration: Phaser.Math.Between(400, 1000),
            repeat: -1
        });
        if (props?.float) {
            coin.body.allowGravity = false;
        }

        coin.once('pickup', () => {
            this.scene.time.delayedCall(45000, () => {
                this.spawnCoin(x, y, obj);
            })
        })

        return coin;
    }

    // Flowline shard pickup. Already-found shards never re-spawn — the
    // id check against GameManager.collectedItems keeps them found
    // across runs (the save system persists that array).
    spawnShard(x, y, obj) {
        const props = getProperty(obj);
        const id = props?.id ?? `flow-${Math.round(x)}-${Math.round(y)}`;
        if (GameManager.collectedItems.includes(id)) return null;
        const shard = new Shard(this.scene, x, y, obj);
        this.itemGroup.add(shard);
        return shard;
    }

    spawnSourceBlock(x, y, data) {
        const block = this.scene.walkableGroup.create(x, y, 'boxsheet')
        this.scene.add.existing(block);
        this.scene.physics.add.existing(block);

        if (!this.scene.anims.get('box'))
            this.scene.anims.create({
                key: 'box',
                frames: this.scene.anims.generateFrameNumbers('boxsheet', { start: 0, end: 3 }),
                frameRate: 6,
                repeat: -1,
                yoyo: true,
            })
        block.play('box')
    }

    // Flowline ranged turret: stationary emplacement that fires aimed
    // fireballs on a timer (Turret class). Pooled like the bat. Replaces the
    // old ad-hoc spawnTurret, which was never called from any tilemap.
    spawnTurret(x, y, obj, health = 25, isRemote = false, id = null) {
        const props = getProperty(obj);
        health = props?.health ?? health;
        let turret = this.turretGroup.getFirst(false);

        if (turret && turret.activate(x, y, health)) {
            turret.init();
            return this.registerNetEnemy(turret, 'turret', x, y, isRemote, id);
        }
        // Create new if no usable turret
        turret = new Turret(this.scene, x, y, health);
        this.turretGroup.add(turret);
        // Fresh spawns must activate too: the constructor can't call
        // scaleCollision (the body doesn't exist until Group.add), so
        // without this the turret kept its unscaled hitbox and skipped
        // its 1.2s opening pause. Same order as the pooled path above.
        turret.activate(x, y, health);
        turret.init();
        return this.registerNetEnemy(turret, 'turret', x, y, isRemote, id);
    }

    // Flowline shielded charger: armored duck that dashes at the player
    // (Charger class). Pooled like the bat.
    spawnCharger(x, y, obj, health = 30, isRemote = false, id = null) {
        const props = getProperty(obj);
        health = props?.health ?? health;
        let charger = this.chargerGroup.getFirst(false);

        if (charger && charger.activate(x, y, health)) {
            charger.init();
            return this.registerNetEnemy(charger, 'charger', x, y, isRemote, id);
        }
        // Create new if no usable charger
        charger = new Charger(this.scene, x, y, health);
        this.chargerGroup.add(charger);
        // Fresh spawns must activate too (see spawnTurret): without this
        // the charger kept its unscaled hitbox and skipped its 1.5s
        // opening pause.
        charger.activate(x, y, health);
        charger.init();
        return this.registerNetEnemy(charger, 'charger', x, y, isRemote, id);
    }

    // World 1 flying bomber: hovers above the fight and drops explosives
    // straight down (Bomber class). Pooled like the turret/charger.
    spawnBomber(x, y, obj, health = 15, isRemote = false, id = null) {
        const props = getProperty(obj);
        health = props?.health ?? health;
        let bomber = this.bomberGroup.getFirst(false);

        if (bomber && bomber.activate(x, y, health)) {
            bomber.init();
            return this.registerNetEnemy(bomber, 'bomber', x, y, isRemote, id);
        }
        // Create new if no usable bomber
        bomber = new Bomber(this.scene, x, y, health);
        this.bomberGroup.add(bomber);
        // Fresh spawns must activate too (see spawnTurret): without this
        // the bomber kept the bat-sized hitbox instead of 40x40 and
        // skipped its 1.5s opening pause.
        bomber.activate(x, y, health);
        bomber.init();
        return this.registerNetEnemy(bomber, 'bomber', x, y, isRemote, id);
    }

    // World 1 swarmer pack: one tilemap object spawns a cluster of three
    // (offsets ±48px, one tile apart), so the map stays readable — one
    // marker per pack — while the fight gets three fast bodies. Pooled
    // like the turret/charger: each swarmer is its own group member.
    spawnSwarmer(x, y, obj, health = 3, isRemote = false, id = null) {
        const props = getProperty(obj);
        health = props?.health ?? health;
        const pack = [];
        for (const dx of [-48, 0, 48]) {
            let swarmer = this.swarmerGroup.getFirst(false);
            if (swarmer && swarmer.activate(x + dx, y, health)) {
                swarmer.init();
            } else {
                swarmer = new Swarmer(this.scene, x + dx, y, health);
                this.swarmerGroup.add(swarmer);
                // Fresh spawns must activate too (see spawnTurret): without
                // this the swarmer kept its unscaled hitbox and skipped its
                // opening setup.
                swarmer.activate(x + dx, y, health);
                swarmer.init();
            }
            // Each pack member gets its own netId from its own spawn
            // point — the host and the client both derive the same three
            // ids from the one tilemap object.
            this.registerNetEnemy(swarmer, 'swarmer', x + dx, y, isRemote);
            pack.push(swarmer);
        }
        return pack;
    }

    // World 1 walking ranged duck: slow patrol, stops to spit an aimed
    // fireball (Spitter class). Pooled like the turret/charger.
    spawnSpitter(x, y, obj, health = 12, isRemote = false, id = null) {
        const props = getProperty(obj);
        health = props?.health ?? health;
        let spitter = this.spitterGroup.getFirst(false);

        if (spitter && spitter.activate(x, y, health)) {
            spitter.init();
            return this.registerNetEnemy(spitter, 'spitter', x, y, isRemote, id);
        }
        // Create new if no usable spitter
        spitter = new Spitter(this.scene, x, y, health);
        this.spitterGroup.add(spitter);
        // Fresh spawns must activate too (see spawnTurret): without this
        // the spitter kept its unscaled hitbox and skipped its 1.5s
        // opening pause.
        spitter.activate(x, y, health);
        spitter.init();
        return this.registerNetEnemy(spitter, 'spitter', x, y, isRemote, id);
    }

    spawnBullets(x, y, amount) {
        for (var i = 0; i < amount; i++) {
            const bullet = new Bullet(this.scene, x, y + (i * 100), 'bullet');
            this.softBulletGroup.add(bullet);
            bullet.setVelocityX(Phaser.Math.Between(-300, -200));
        };
    }

    spawnBullet(x, y) {
        const bullet = new Bullet(this.scene, x, y, 'bullet');
        this.softBulletGroup.add(bullet);
        bullet.setVelocityX(-300);
    }

    spawnFireballs(x, y) {
        const bullet = new Bullet(this.scene, x, y, 'fireballsheet');
        this.softBulletGroup.add(bullet);
        bullet.setVelocityX(-450);
        if (!this.scene.anims.get('fireball'))
            this.scene.anims.create({
                key: 'fireball',
                frames: this.scene.anims.generateFrameNumbers('fireballsheet', { start: 0, end: 2 }),
                frameRate: 8,
                repeat: -1,
            });
        bullet.play('fireball');

        return bullet;
    }

    spawnBooster(x, y, obj) {
        const booster = new Booster(this.scene, x, y, obj);
        this.staticItemGroup.add(booster);
    }

    spawnDashBuff(x, y, obj) {
        const dashBuff = new DashBuff(this.scene, x, y);
        this.staticItemGroup.add(dashBuff);

        dashBuff.once('pickup', () => {
            this.scene.time.delayedCall(45000, () => {
                this.spawnDashBuff(x, y, obj);
            })
        })
    }

    spawnPortal(x, y, obj) {
        const newX = x;
        const newY = y;
        const portal = new Portal(this.scene, newX, newY, obj)
        this.staticItemGroup.add(portal);

    }

    spawnFinishLine(x, y, obj) {
        const finish = new FinishLine(this.scene, x, y, obj);
        this.staticItemGroup.add(finish);
    }

    respawn(obj, x, y, health, spawnFunc) {
        if (!obj) return;
        obj.once('die', () => {
            const checkDistanceTimer = this.scene.time.addEvent({
                delay: 5000, // check every 1 second (adjust if you want)
                callback: () => {
                    const dx = this.scene.player.x - x;
                    const dy = this.scene.player.y - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance > 1200) {
                        this.scene.time.removeEvent(checkDistanceTimer);
                        // Host-driven only (Part 2): a non-host's local
                        // respawn would create an enemy the host doesn't
                        // know about. The host respawns and its state
                        // broadcast brings the puppet back on non-hosts.
                        // Checked at fire time, not registration: if this
                        // client BECOMES host while the timer is pending,
                        // the respawn is legitimately theirs now. And if
                        // a live enemy already holds this spawn point's
                        // netId (host respawned first), don't duplicate it.
                        if (!this.scene.network?.isHost()) return;
                        const netId = `duck:${Math.round(x)}:${Math.round(y)}`;
                        const existing = this.netEnemies.get(netId);
                        if (existing && existing.active && !existing.dead) return;
                        spawnFunc(x, y, health);
                    }
                },
                loop: true
            });
            this.scene.events.once('shutdown', () => {
                this.scene.time.removeEvent(checkDistanceTimer);
            })

        });
    }

    spawnLaser(x, y, obj) {
        const laser = new LaserSprite(this.scene, x, y, this.player, obj)
    }

    spawnText(x, y, obj) {
        const text = this.scene.add.text(x, y, obj.text.text, {
            fontStyle: 'bold',
            fontSize: '20px',
            color: '#FFFFFF',
        }).setScrollFactor(1);
    }

    spawnCard(x, y, obj, type = null, value = null) {
        const props = getProperty(obj);
        const card = new CardPickup(this.scene, x, y, props?.type || type || null, props?.value || value || null);
        this.cardGroup.add(card);
        if (props?.float) {
            card.body.allowGravity = false;
        }

        if(this.cardGroup.getChildren().length > 100) {
            const oldestCard = this.cardGroup.getFirst(true);
            oldestCard?.playerCollide?.(this.player);
            this.cardGroup.remove(oldestCard, true, true);
        }

        return card;
    }
}