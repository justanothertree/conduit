import { startKeyFor } from './timeTrialGhost.js';

const CURRENT_VERSION = 0.118;

// Time-trial best runs: { [levelKey]: { [startKey]: { time, startX,
// startY, x[], y[], f } } } — one best PER START POINT (see
// things/timeTrialGhost.js): a checkpoint leg never overwrites the
// full-run best. Recordings are player-local save data, so validate
// their shape before trusting them — a corrupt or hand-edited save
// must not throw in the ghost replay or balloon memory. The
// 3600-sample cap mirrors TRIAL_MAX_SAMPLES in
// things/timeTrialGhost.js (6 minutes at 10Hz); the 8-entry cap
// mirrors TRIAL_MAX_STARTS (a level only has a handful of starts).
// Legacy saves hold ONE flat run per level (no start-point key):
// those are wrapped under the run's own start key and keep working
// as that start's best.

function sanitizeBestRun(run) {
    if (!run || typeof run !== 'object') return null;
    if (!Number.isFinite(run.time) || run.time <= 0) return null;
    if (!Number.isFinite(run.startX) || !Number.isFinite(run.startY)) return null;
    if (!Array.isArray(run.x) || !Array.isArray(run.y)) return null;
    if (run.x.length !== run.y.length || run.x.length === 0) return null;
    if (run.x.length > 3600) return null;
    if (typeof run.f !== 'string' || run.f.length !== run.x.length) return null;
    if (!/^[01]*$/.test(run.f)) return null;
    if (!run.x.every((v) => Number.isFinite(v) && Math.abs(v) < 100000)) return null;
    if (!run.y.every((v) => Number.isFinite(v) && Math.abs(v) < 100000)) return null;
    return {
        time: run.time,
        startX: run.startX,
        startY: run.startY,
        x: run.x,
        y: run.y,
        f: run.f,
    };
}

function sanitizeBestRuns(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = {};
    for (const key of Object.keys(data)) {
        const level = data[key];
        if (!level || typeof level !== 'object') continue;
        // Legacy shape: the level value IS a run (flat, no start key).
        const legacy = sanitizeBestRun(level);
        if (legacy) {
            out[key] = { [startKeyFor(legacy.startX, legacy.startY)]: legacy };
            continue;
        }
        // Current shape: { [startKey]: run } — re-key by each run's
        // own start, so a hand-edited key can't strand a run under
        // the wrong start point.
        const starts = {};
        for (const startKey of Object.keys(level)) {
            if (Object.keys(starts).length >= 8) break;
            const run = sanitizeBestRun(level[startKey]);
            if (!run) continue;
            starts[startKeyFor(run.startX, run.startY)] = run;
        }
        if (Object.keys(starts).length) out[key] = starts;
    }
    return out;
}

export default {
    version: CURRENT_VERSION,
    name: { text: 'Hunter', color: '#FFFFFF' },
    location: { x: 0, y: 0 },
    area: 'Home',
    power: { money: 0, spent: 0, auraLevel: 1, vault: 0},
    upgrades: {},
    stats: { healthMax: 25, health: 25 },
    weapons: { left: 'shurikan', right: 'sword', aura: 'zap' },
    volume: { master: 1, music: 1, voice: 1 },
    collectedItems: [],
    cards: [],
    // Personal-best time-trial recordings, one per start point per
    // level (see things/timeTrialGhost.js). Session-only checkpoint
    // stays separate.
    bestRuns: {},
    flags: {
        seenIntro: false,
        devmode: false,
    },
    useLastLocation: false,
    // Session-only (never serialized): World 1's per-run respawn
    // checkpoint { scene, x, y, index }. Cleared on fresh level entries
    // (Home portal overlap, ?scene= jumps) and on reload.
    checkpoint: null,

    save() {
        const data = {
            version: this.version,
            name: this.name,
            location: this.location,
            area: this.area,
            power: this.power,
            upgrades: this.upgrades,
            stats: this.stats,
            weapons: this.weapons,
            volume: this.volume,
            collectedItems: this.collectedItems,
            cards: this.cards,
            bestRuns: this.bestRuns,
            flags: this.flags,
            useLastLocation: this.useLastLocation,
        };
        localStorage.setItem('webConduitSave', JSON.stringify(data));
    },

    load() {
        const data = localStorage.getItem('webConduitSave');
        if (data) {
            // A corrupt save (truncated write, hand edit) must not kill
            // the boot: JSON.parse throws, and load() runs in
            // Preloader.create. Warn and keep the defaults instead — the
            // next save() overwrites the bad string with valid JSON.
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch (e) {
                console.warn('Corrupt save in localStorage; starting with defaults.', e);
                return;
            }

            if (parsed.version !== CURRENT_VERSION) {
                console.warn('Save version mismatch. Resetting world state, preserving earned progression.');

                // Version upgrades reset genuinely version-incompatible fields
                // (location/area may not exist in new maps, stats schema may change),
                // but the player's earned long-term progression survives:
                // collectedItems (shard collection record), flags (one-time event
                // flags such as all-shards bonus payout), and upgrades (shard shop
                // levels + shardsSpent) are all re-applied through reset()'s keep.
                this.reset({
                    keep: {
                        name: parsed.name,
                        volume: parsed.volume,
                        weapons: parsed.weapons,
                        power: parsed.power,
                        cards: parsed.cards,
                        collectedItems: parsed.collectedItems,
                        bestRuns: parsed.bestRuns,
                        flags: parsed.flags,
                        upgrades: parsed.upgrades,
                    }
                });

                return;
            }

            // Normal loading path
            this.version = parsed.version ?? CURRENT_VERSION;
            this.location = parsed.location ?? { x: 0, y: 0 };
            this.name = parsed.name ?? { text: 'Hunter', color: '#FFFFFF' };
            this.area = parsed.area ?? 'Home';
            this.power = parsed.power ?? { money: 0, spent: 0, auraLevel: 1, vault: 0};
            this.upgrades = parsed.upgrades ?? {};
            this.stats = parsed.stats ?? { healthMax: 25, health: 25 };
            this.weapons = parsed.weapons ?? { left: 'shurikan', right: 'sword', aura: 'zap' };
            this.volume = parsed.volume ?? { master: 1, music: 1, voice: 1 };
            this.collectedItems = parsed.collectedItems ?? [];
            this.cards = parsed.cards ?? [];
            this.bestRuns = sanitizeBestRuns(parsed.bestRuns);
            this.flags = parsed.flags ?? {};
            this.useLastLocation = parsed.useLastLocation ?? false;
        }
    },

    reset({ keep = {} } = {}) {
        // Merge preserved values first
        this.version = CURRENT_VERSION;
        this.name = keep.name ?? { text: 'Hunter', color: '#FFFFFF' };
        this.location = { x: 0, y: 0 };
        this.area = keep.area ?? 'Home';
        this.power = keep.power ?? { money: 0, spent: 0, auraLevel: 1, vault: 0};
        this.upgrades = keep.upgrades ?? {};
        this.stats = keep.stats ?? { healthMax: 25, health: 25 };
        this.weapons = keep.weapons ?? { left: 'shurikan', right: 'sword', aura: 'zap' };
        this.volume = keep.volume ?? { master: 1, music: 1, voice: 1 };
        this.collectedItems = keep.collectedItems ?? [];
        this.cards = keep.cards ?? [];
        this.bestRuns = sanitizeBestRuns(keep.bestRuns);
        this.flags = keep.flags ?? {
            seenIntro: false,
            devmode: false,
        };
        this.useLastLocation = false;
        this.checkpoint = null;

        this.save();
    },

    clear() {
        localStorage.removeItem('webConduitSave');
    },

    // The current scene key rides along so other clients can elect a
    // per-level host (Part 2): the host is the lowest socket id among
    // players whose data.scene matches the level. The server stores
    // `data` opaquely and re-broadcasts it as-is, so no server change
    // is needed for this field. Callers pass the live scene key —
    // GameManager.area lags behind on level entry.
    getNetworkData(sceneKey) {
        return {
            scene: sceneKey ?? this.area ?? 'Home',
            location: {
                x: this.location.x,
                y: this.location.y
            },
            name: {
                text: this.name?.text ?? 'Hunter',
                color: this.name?.color ?? '#ffffff'
            },
            power: {
                money: this.power?.money ?? 0,
                auraLevel: this.power?.auraLevel ?? 1
            },
            stats: {
                health: this.stats?.health ?? 25,
                healthMax: this.stats?.healthMax ?? 25
            }
        };
    },
}