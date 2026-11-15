// Time-trial ghost: a translucent shadow of the player's fastest run.
//
// Personal best only — local save, no server, no multiplayer. A global
// fastest-player ghost would need Josh's server to store/serve recordings,
// so that is explicitly out of scope (future work).
//
// Recording: 10Hz samples of (x, y, facing) from run start to the finish
// line, stored in GameManager.bestRuns[level] as compact parallel arrays
// (rounded ints + one '0'/'1' char per sample for facing). A 2-minute run
// is ~1200 samples, ~13KB of JSON — small against localStorage.
// Replay: a lightweight Container (player sprite + best-time label) that
// follows the samples, lerped, synced to the scene's race clock. It has
// no physics body, collides with nothing, and never blocks the player.

export const TRIAL_SAMPLE_RATE = 10;   // samples per second
export const TRIAL_MAX_SAMPLES = 3600; // 6 minutes at 10Hz; longer runs
// are not saved as a best (the recording would be truncated)
export const TRIAL_START_TOLERANCE = 64; // px: the ghost only shows when
// this run starts where the best run started. World 1 respawns at
// checkpoints, so a best leg only replays from its own checkpoint.

export function formatTrialTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return m + ':' + s.toFixed(2).padStart(5, '0');
}

// Pure interpolation over a stored run: position + facing at a given
// race-clock time. Returns null once the recording has run out.
export function sampleAt(run, timeSeconds) {
    const t = timeSeconds * TRIAL_SAMPLE_RATE;
    // Past the last sample the recording has run out — the ghost vanishes
    // instead of lingering on the finish spot.
    if (t < 0 || t > run.x.length - 1) return null;
    const i = Math.floor(t);
    const frac = t - i;
    const j = Math.min(i + 1, run.x.length - 1);
    return {
        x: run.x[i] + (run.x[j] - run.x[i]) * frac,
        y: run.y[i] + (run.y[j] - run.y[i]) * frac,
        f: run.f[i] === '1',
    };
}

export class TimeTrialRecorder {
    constructor(scene) {
        this.scene = scene;
        this.startX = scene.player.x;
        this.startY = scene.player.y;
        this.x = [];
        this.y = [];
        this.f = '';
        this.lastIndex = -1;
        this.capped = false;
    }

    // Called every frame with the scene's race clock. Samples only when
    // the clock crosses a new 10Hz boundary; if a hitch jumps the clock
    // more than one boundary, the gap is filled with the current position
    // so the replay stays time-synced instead of running short.
    sample(raceTime) {
        const index = Math.floor(raceTime * TRIAL_SAMPLE_RATE);
        if (index <= this.lastIndex) return;
        const player = this.scene.player;
        if (!player) return;
        const x = Math.round(player.x);
        const y = Math.round(player.y);
        const f = player.flipX ? '1' : '0';
        for (let i = this.lastIndex + 1; i <= index; i++) {
            if (this.x.length >= TRIAL_MAX_SAMPLES) {
                this.capped = true;
                return;
            }
            this.x.push(x);
            this.y.push(y);
            this.f += f;
        }
        this.lastIndex = index;
    }

    // Returns the storable best-run record, or null when the recording
    // is incomplete (hit the cap) — a truncated ghost is worse than
    // keeping the old best.
    toBestRun(time) {
        if (this.capped || this.x.length === 0) return null;
        return {
            time,
            startX: Math.round(this.startX),
            startY: Math.round(this.startY),
            x: this.x,
            y: this.y,
            f: this.f,
        };
    }
}

export class TimeTrialGhost extends Phaser.GameObjects.Container {
    constructor(scene, bestRun) {
        super(scene, bestRun.x[0], bestRun.y[0]);
        this.bestRun = bestRun;
        this.setDepth(7);
        scene.add.existing(this);

        // Same sprite + scale as the player (and the multiplayer ghost),
        // cyan-tinted and semi-transparent so it reads as a shadow, not
        // a second player.
        this.sprite = scene.add.sprite(0, 0, 'dudesheet');
        this.sprite.setScale(0.35);
        this.sprite.setAlpha(0.5);
        this.sprite.setTint(0x00ffff);
        this.sprite.setOrigin(0.5, 0.5);
        this.add(this.sprite);

        this.label = scene.add.text(0, -this.sprite.displayHeight * 0.75,
            'BEST ' + formatTrialTime(bestRun.time), {
                fontSize: '12px',
                align: 'center',
                fill: '#66ffee',
            }).setOrigin(0.5);
        this.label.setAlpha(0.8);
        this.add(this.label);
    }

    preUpdate() {
        const scene = this.scene;
        // The race clock is the sync source: no timer (finished, or the
        // scene moved on) means the ghost's run is over.
        if (!scene.raceTimer || typeof scene.raceTime !== 'number') {
            this.destroy();
            return;
        }
        const pos = sampleAt(this.bestRun, scene.raceTime);
        if (!pos) {
            // Recording ended (or the player outran it) — vanish.
            this.destroy();
            return;
        }
        const dx = pos.x - this.x;
        const dy = pos.y - this.y;
        this.setPosition(pos.x, pos.y);
        this.sprite.flipX = pos.f;
        // Animation read from movement, mirroring GhostPlayer's mapping
        // (walk / jump / idle) without any network state.
        if (dy < -1) {
            this.sprite.stop();
            this.sprite.setFrame(5);
        } else if (Math.abs(dx) > 1) {
            this.sprite.play('dudewalk', true);
        } else {
            this.sprite.stop();
            this.sprite.setFrame(0);
        }
    }
}
