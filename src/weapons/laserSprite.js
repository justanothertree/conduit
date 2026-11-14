import { getProperty } from "../myFunctions";

//Properties: int length, bool doesFlicker, int start, int onTime, int offTime
export default class LaserSprite extends Phaser.GameObjects.TileSprite {
    constructor(scene, x, y, player, obj) {
        super(scene, x, y, 0, 16, 'zap');
        // ...
        this.player = player;
        this.props = getProperty(obj);
        const props = this.props;

        this.length = props.length;

        if (!this.scene.laserList) {
            this.scene.laserList = {}
        }
        this.scene.laserList[props?.index] = this;

        if (props.doesFlicker) {
            this.flicker();
        }

        this.rotation = Phaser.Math.DegToRad(obj.rotation);
        this.setOrigin(0, 0.5);
        this.setTint('0xFF0000');
        scene.add.existing(this);

        // Scratch objects reused by the per-frame boxTrace() — allocating a
        // fresh Vector2/Line/Rectangle every frame (60x/sec per active laser)
        // is steady GC churn on phones (same class as BaseEnemy.currentSpeed).
        this._origin = new Phaser.Math.Vector2();
        this._playerBounds = new Phaser.Geom.Rectangle();
        this._ray = new Phaser.Geom.Line();
        this._closest = new Phaser.Math.Vector2();
    }

    init(target) {
        this.target = target;
        this.updateZapLine();
        this.activate();
    }

    preUpdate(time, delta) {
        if (!this.active) return;
        this.updateZapLine();
        this.tilePositionX += 10;
        this.boxTrace();
    }

    deactivate() {
        this.setVisible(false);
        this.setActive(false);
    }

    activate() {
        this.setActive(true);
        this.setVisible(true);
    }

boxTrace() {
    if (!this.player) return;
    const origin = this.getWorldPoint(this._origin);
    const dirX = Math.cos(this.rotation) * this.length;
    const dirY = Math.sin(this.rotation) * this.length;
    this._ray.setTo(origin.x, origin.y, origin.x + dirX, origin.y + dirY);

    // Shrink the bounds by 15px on each side, as before — Inflate mutates
    // (and returns) the scratch rect, so no fresh Rectangle is allocated.
    const playerBounds = Phaser.Geom.Rectangle.Inflate(
        this.player.getBounds(this._playerBounds), -15, -15);

    // Check if the player is in front of the laser
    const toPlayerX = this.player.x - origin.x;
    const toPlayerY = this.player.y - origin.y;
    if (toPlayerX * dirX + toPlayerY * dirY < 0) return; // Behind the laser

    // Ensure player is within max range
    const closestPoint = this._closest.set(
        Phaser.Math.Clamp(origin.x, playerBounds.left, playerBounds.right),
        Phaser.Math.Clamp(origin.y, playerBounds.top, playerBounds.bottom));
    const distanceToTarget = Phaser.Math.Distance.Between(origin.x, origin.y, closestPoint.x, closestPoint.y);
    if (distanceToTarget > this.length) return;

    // Check actual intersection (only returns true/false)
    const didHit = Phaser.Geom.Intersects.LineToRectangle(this._ray, playerBounds);
    if (didHit) {
        this.player.hitLaser(closestPoint); // Or maybe use `this.player.x/y`
    }
}



    flicker() {
        // if (this.flickerTimer) {
        //     this.scene.time.removeEvent(this.flickerTimer)
        // }
        const start = this.props.start || 0;
        const onTime = this.props.onTime || 3000;
        const offTime = this.props.offTime || 1000;
        this.flickerTimer = this.scene.time.addEvent({
            delay: onTime,
            startAt: start,
            loop: true,
            callback: () => {
                if (this.active) {
                    this.deactivate();
                    this.flickerTimer.delay = offTime;
                } else {
                    this.activate();
                    this.flickerTimer.delay = onTime;
                }
            }
        })
    }

    updateZapLine() {
        // Plain scalar math — getForwardVector used to allocate a fresh
        // Vector2 here (twice per call, every frame) for the same cos/sin.
        const dx = Math.cos(this.rotation) * this.length;
        const dy = Math.sin(this.rotation) * this.length;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        this.setRotation(angle);
        this.displayWidth = length;
    }


}
