import BaseEnemy from "./_baseEnemy.js";

// FLOWLINE's shielded charger: an armored duck (steel-blue tint, same
// DuckFloaty art as the other ducks) that patrols open ground and, when the
// player gets close, telegraphs then commits to a full-speed dash at them.
//
// Frontal shield: attacks from the front are absorbed (zero damage) while
// the shield is up. Hits from behind, or ANY hit once it commits to its
// charge (the shield drops while it charges and recovers), deal full
// damage. The shield state lives in TakeDamage — weapons hand us their
// knockback vector, which always points away from the attacker, so a
// frontal hit pushes against the charger's facing. Enemies have no hit()
// method; damage arrives through TakeDamage, which is why the modifier
// lives here.
//
// Movement reuses existing mechanics only: the base patrol() for walking,
// plain setVelocityX for the dash. Player movement/physics untouched.
export default class Charger extends BaseEnemy {
    constructor(scene, x, y, health = 30) {
        super(scene, x, y, 'duck', health);

        this.name = 'charger';
        this.damage = 4;          // contact damage (base playerCollide)
        this.walkSpeed = 130;
        this.chargeSpeed = 520;
        this.chargeRange = 380;   // px — starts telegraphing inside this
        this.chargeCooldown = 2600; // ms between charges
        this.windUp = 600;        // ms telegraph before the dash
        this.chargeTime = 650;    // ms the dash lasts
        this.recoverTime = 900;   // ms catching its breath (shield down)
        this.state = 'walk';      // 'walk' | 'windup' | 'charging' | 'recover'
        this.shieldDown = false;
        this.nextCharge = 0;
        this.stateEnd = 0;
        this.setTint(0x7fb2d9);   // steel blue — reads as "armored"
        // NOTE: scaleCollision is NOT called here — this.body is null until
        // the sprite joins the physics world (Group.add). It's called in
        // activate() instead, like the Boss does.
    }

    activate(x, y, health = 30) {
        super.activate(x, y, health);
        this.setScale(0.45); // bigger than a duck (0.3), smaller than the boss (0.75)
        this.setTint(0x7fb2d9); // activate() clears tint
        this.scaleCollision(70, 70); // body exists now (in the physics world)
        this.state = 'walk';
        this.shieldDown = false;
        this.direction = 1;
        this.nextCharge = this.scene.time.now + 1500; // a beat before it starts
        this.stateEnd = 0;
        return true;
    }

    // After the base hit-flash clears the tint, restore the steel color.
    restoreTint() {
        this.setTint(0x7fb2d9);
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.dead || this.stunned) return;
        const now = this.scene.time.now;
        switch (this.state) {
            case 'walk': this.walk(now); break;
            case 'windup': this.windup(now); break;
            case 'charging': this.charging(now); break;
            case 'recover': this.recovering(now); break;
        }
    }

    walk(now) {
        this.speed = this.walkSpeed;
        this.patrol(now); // inherited edge-aware ground patrol
        const dist = this.distanceToPlayer() ?? Infinity;
        if (dist < this.chargeRange && now >= this.nextCharge) {
            this.state = 'windup';
            this.stateEnd = now + this.windUp;
            this.facePlayer();
            this.setVelocityX(0);
            this.setTint(0xffdd33); // telegraph — yellow flash
        }
    }

    windup(now) {
        this.facePlayer(); // tracks the player while winding up
        if (now >= this.stateEnd) {
            this.state = 'charging';
            this.stateEnd = now + this.chargeTime;
            this.shieldDown = true; // committed — shield drops, vulnerable
            this.restoreTint();
            this.setVelocityX(this.direction * this.chargeSpeed);
        }
    }

    charging(now) {
        const hitWall = this.body?.blocked.left || this.body?.blocked.right
            || this.body?.touching.left || this.body?.touching.right;
        // Ledge check, mirroring patrol(): probe the ground ahead in the
        // locked charge direction; no tile below means a ledge, so brake
        // into recover instead of dashing off the platform.
        const aheadX = this.x + this.direction * 44;
        const groundTile = this.scene.walls?.getTileAtWorldXY(aheadX, this.y + 64);
        const overLedge = !groundTile || groundTile.index === -1;
        if (now >= this.stateEnd || hitWall || overLedge) {
            this.state = 'recover';
            this.stateEnd = now + this.recoverTime;
            this.setVelocityX(0);
        }
    }

    recovering(now) {
        if (now >= this.stateEnd) {
            this.state = 'walk';
            this.shieldDown = false; // shield back up
            this.nextCharge = now + this.chargeCooldown;
        }
    }

    facePlayer() {
        if (!this.player) return;
        const dx = this.player.x - this.x;
        if (Math.abs(dx) > 10) this.direction = Math.sign(dx);
        this.flipX = this.direction > 0;
    }

    // Directional damage modifier. Weapons push the target away from the
    // attacker, so a frontal hit's knockback points against our facing
    // (Math.sign(x) === -this.direction). Shield up + frontal = absorbed;
    // from behind, or shield down (mid-charge / recovering), = full damage.
    TakeDamage(x, y, damage = 1, stunDuration = 300) {
        if (this.dead || !this.canDamage) return false;
        const frontal = x !== 0 && Math.sign(x) === -this.direction;
        if (frontal && !this.shieldDown) {
            this.flashShield();
            return true; // registered as a hit, deals nothing
        }
        return super.TakeDamage(x, y, damage, stunDuration);
    }

    flashShield() {
        this.setTint(0xbbdefb);
        this.scene?.time.delayedCall(120, () => {
            if (!this.dead) this.restoreTint();
        });
    }
}
