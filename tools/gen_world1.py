#!/usr/bin/env python3
"""Generate public/assets/tilemapWorld1.json — the WORLD 1 level for Conduit.

WORLD 1 is a combat-forward level: arena rooms linked by short corridors,
mixing turrets (stationary, telegraphed aimed fireballs) and chargers
(shielded dash attackers) in Krazay17-style layouts, ending in a second
bullet-hell boss (the Iron Warden). Four checkpoints split the run into
~1-minute legs so a phone run takes ~3-5 minutes.

Movement calibration (read from the player code, not changed):
  full held jump ~= 125px (~4 tiles), dash speed 900, wall jump exists.
  Design rule: vertical steps <= 3 tiles, horizontal gaps <= 6 (dashable).

Layout (tiles, 32px; map is 168x80, y grows downward):
  A  Breach        x  2-22    spawn, checkpoint 0, ducks, spitter, sign,
                             secret hop
  B  Turret alley  x 24-46    2 turrets on platforms, cover blocks, charger,
                             checkpoint 1 at the exit
  C  The pit       x 48-72    lava pit with platform hops, bats, turret on
                             the far shore, swarmer pack, checkpoint 2
                             at the exit
  D  Charger den   x 74-96    open arena: 3 chargers, 2 turrets on ledges,
                             2 bombers overhead, swarmer pack, spitter,
                             cover blocks
  D2 Antechamber   x 98-118   640px-wide room (was 256px): the Bombardier
                             mini-boss, stepped platforms so the fight has
                             room to breathe and dodge in (checkpoint 3 sits
                             just west of the room, in the den — see below)
  E  Boss arena    x 120-152  Iron Warden (boss 2), 1056px wide (was 736px),
                             stair-stepped platforms (<=3-tile rises) for
                             wall-jump/dash play, ground doorway in the
                             left wall, climb-out over the right wall
  F  Vault         x 153-166  finish line, Home return portal, card, shard

Layers match the other maps: layer1 (empty — the nebula sky shows
through), layer2 (background accents in Krazay17's tilemap2 style —
braziers, pots, grass, moss, bushes, tech blocks, never colliding),
objects, walls (stone 157, collides), walls2 (lava 329/330,
fire damage). Tileset "tilesheet" (32px tiles).
"""
import json
import sys

W, H = 168, 80
STONE, LAVA, LAVA2 = 157, 329, 330

walls = [0] * (W * H)
walls2 = [0] * (W * H)
layer1 = [0] * (W * H)
layer2 = [0] * (W * H)


def set_tile(layer, x, y, gid):
    if 0 <= x < W and 0 <= y < H:
        layer[y * W + x] = gid


def rect(layer, x0, y0, x1, y1, gid):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            set_tile(layer, x, y, gid)


def platform(x, y, w, gid=STONE):
    rect(walls, x, y, x + w - 1, y, gid)


# ---------------------------------------------------------------- objects
objects = []
_next_id = [1]


def prop(name, ptype, value):
    return {"name": name, "type": ptype, "value": value}


def add(name, tx, ty, w=32, h=32, props=None, rotation=0, text=None):
    obj = {
        "height": h,
        "id": _next_id[0],
        "name": name,
        "rotation": rotation,
        "type": "",
        "visible": True,
        "width": w,
        "x": tx * 32,
        "y": ty * 32,
    }
    _next_id[0] += 1
    if props:
        obj["properties"] = props
    if text is not None:
        obj["text"] = {"text": text, "wrap": True}
    objects.append(obj)
    return obj


def coin(tx, ty, float_=False):
    add("spawnCoin", tx, ty,
        props=[prop("float", "bool", True)] if float_ else None)


def coin_line(x0, y0, x1, y1, n, float_=False):
    for i in range(n):
        t = i / max(n - 1, 1)
        coin(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), float_)


_shard_n = [0]


def shard(tx, ty):
    _shard_n[0] += 1
    add("spawnShard", tx, ty,
        props=[prop("id", "string", f"w1-{_shard_n[0]:02d}")])


_ckpt_n = [0]


def checkpoint(tx, ty):
    add("spawnCheckpoint", tx, ty,
        props=[prop("index", "int", _ckpt_n[0])])
    _ckpt_n[0] += 1


# ================================================================ geometry
# borders
rect(walls, 0, 0, 1, H - 1, STONE)
rect(walls, 166, 0, 167, H - 1, STONE)

# ---- A: breach
rect(walls, 2, 70, 22, 79, STONE)
add("spawnPlayer", 8, 66)
add("spawnText", 6, 61, text="WORLD 1")
checkpoint(11, 66)                       # checkpoint 0: the start
add("spawnDuck", 15, 66)
add("spawnDuck", 19, 66)
# A lone spitter at the breach exit: the first ranged walker the player
# meets — it teaches the "close in during the wind-up" answer before
# the turret alley stacks ranged pressure.
add("spawnSpitter", 21, 66)
platform(3, 66, 3)                       # secret hop
for i in range(6, 20, 2):
    coin(i, 66)
shard(17, 62)                            # w1-01: on the path
shard(4, 64)                             # w1-02: above the secret hop

# ---- B: turret alley
rect(walls, 24, 70, 46, 79, STONE)
platform(28, 64, 3)
add("spawnTurret", 29, 60)               # turret 1 over the entrance
rect(walls, 33, 67, 34, 69, STONE)       # cover block
add("spawnCharger", 36, 66)              # charger on the alley floor
platform(38, 60, 3)
add("spawnTurret", 39, 56)               # turret 2 over the exit
rect(walls, 43, 67, 44, 69, STONE)       # cover block
coin_line(25, 66, 45, 66, 6)
shard(26, 64)                            # w1-03: under turret 1's nose
shard(40, 55)                            # w1-04: above turret 2 (risk)
checkpoint(46, 66)                       # checkpoint 1: alley cleared

# ---- C: the pit (lava with platform hops)
rect(walls2, 48, 74, 62, 79, LAVA)
rect(walls2, 52, 74, 54, 76, LAVA2)
rect(walls2, 58, 74, 60, 76, LAVA2)
for (px, py) in [(50, 66), (56, 63), (62, 66)]:
    platform(px, py, 4)
rect(walls, 63, 70, 72, 79, STONE)       # far shore
add("spawnTurret", 67, 66)               # turret 3 guards the far shore
add("spawnSwarmer", 68, 66)               # swarmer pack: 3 fast ducklings
add("spawnBat", 54, 56)
add("spawnBat", 60, 52)
coin_line(50, 62, 54, 59, 3, float_=True)
coin_line(58, 59, 62, 62, 3, float_=True)
shard(57, 57)                            # w1-05: mid-air over the pit
shard(51, 71)                            # w1-06: low over the lava (risk)
checkpoint(70, 66)                       # checkpoint 2: pit crossed

# ---- D: charger den
rect(walls, 74, 70, 96, 79, STONE)
platform(78, 60, 3)
add("spawnTurret", 79, 56)               # turret 4 on the west ledge
platform(90, 60, 3)
add("spawnTurret", 91, 56)               # turret 5 on the east ledge
add("spawnCharger", 81, 66)
add("spawnCharger", 87, 66)
add("spawnCharger", 93, 66)
add("spawnBomber", 82, 54)               # bomber 1: over the den, west
add("spawnBomber", 93, 54)               # bomber 2: over the den, east
add("spawnSwarmer", 77, 66)               # swarmer pack: west end of the den
add("spawnSpitter", 95, 66)               # spitter: east end, by the cover
add("spawnSourceBlock", 84, 66)          # cover
add("spawnSourceBlock", 96, 66)          # cover
for i in range(76, 95, 2):
    coin(i, 66)
shard(86, 52)                            # w1-07: high over the den
# Checkpoint 3 sits at the den's east end, just OUTSIDE the antechamber:
# the old spot (tile 103, x 3296) was inside the Bombardier trigger
# (player.x > arenaLeft + 96 = 3232), so every Warden retry respawned
# the player sealed inside the room with a hard-mode Bombardier.
# Tile 91 is the closest free floor tile west of the room — tiles 92/94
# hold coins, 93 a charger, 95 the spitter, 96 the cover block — 320px
# clear of the trigger line and on the walk back into the fight.
checkpoint(91, 66)                       # checkpoint 3: den's east end
# antechamber before the boss — 640px wide (tiles 98-118), up from 256px:
# the Bombardier fight finally has room to breathe. Stepped platforms
# (<=3-tile rises, the generator's movement rule) give the player
# vertical dodging against aimed bombs and the ground sweeper, and a
# high perch for the risk shard. The room's interior is tiles 98-117
# (px 3136-3776); the mini-boss gate in enemyMiniboss.js (spawn ±320px)
# and the intro lock rects in _baseEnemy must match these bounds.
rect(walls, 98, 70, 118, 79, STONE)
platform(101, 67, 3)                     # west low step
platform(108, 64, 4)                     # mid step
platform(114, 61, 3)                     # high perch
add("spawnText", 99, 62, text="BOSS AHEAD")
add("spawnDashBuff", 100, 66)
# The Bombardier mini-boss guards the antechamber (replaces the 3rd
# bomber — the room is the mini-boss's arena, and it drops bombs anyway).
# Spawn is the room's center tile (108), so the ±320px gate stays
# centered on the room.
add("spawnMiniboss", 108, 58, props=[prop("health", "int", 250)])
shard(115, 54)                           # w1-08: high over the fight (risk)

# ---- E: boss arena (Iron Warden) — 1056px wide (tiles 120-152), up
# from 736px. The old arena was a flat floor with two unreachable
# platforms (8 tiles up, past the ~4-tile jump), so the bullet patterns
# had nowhere to dodge to. The new arena stair-steps up both sides to a
# high center platform — every rise is <=3 tiles and every gap <=6, so
# plain jumps chain across it, and the tall side walls still reward
# wall-runs. Platforms are footing, not cover (boss fireballs don't
# collide with tiles): they give the player vertical escape lanes
# against the sweep rows and a perch above the slam's ground waves.
rect(walls, 120, 70, 152, 79, STONE)     # floor
rect(walls, 118, 56, 119, 67, STONE)     # left wall with a ground doorway
rect(walls, 150, 62, 151, 69, STONE)     # right wall (climb out over it)
platform(122, 67, 4)                     # west low
platform(127, 64, 4)                     # west mid
platform(132, 61, 5)                     # high center
platform(139, 64, 4)                     # east mid
platform(144, 67, 4)                     # east low
platform(148, 64, 2)                     # exit step to the right wall top
add("spawnBoss2", 136, 64, props=[prop("health", "int", 600)])
for i in range(122, 149, 2):
    coin(i, 66)
shard(123, 63)                           # w1-09: above west low
shard(148, 60)                           # w1-10: above the exit step
shard(134, 57)                           # w1-11: high center (risk)

# ---- F: vault
rect(walls, 153, 70, 166, 79, STONE)
add("spawnFinishLine", 157, 66)
add("spawnCard", 158, 62, props=[prop("float", "bool", True)])
for i in range(154, 165, 2):
    coin(i, 66)
shard(156, 62)                           # w1-12: the vault

# ================================================================ decoration
# layer1/layer2 are pure background: setupTileMap only ever collides
# walls/walls2, so tiles here can't affect gameplay, collision, or spawns.
# Style follows Krazay17's tilemap2 — sparse hand-placed foreground accents
# on layer2, layer1 left empty so the nebula sky stays dominant. All gids
# below already exist in the tileset; placement is guarded by open_air() so
# nothing overlaps walls, lava, spawns, shards, or the boss arena.
import random
rng = random.Random(20261104)  # deterministic — regen is byte-identical

reserved = {(o["x"] // 32, o["y"] // 32) for o in objects}


def open_air(x, y):
    return (0 <= x < W and 0 <= y < H
            and walls[y * W + x] == 0 and walls2[y * W + x] == 0
            and (x, y) not in reserved)


def accent(x, y, gid):
    if open_air(x, y):
        set_tile(layer2, x, y, gid)


BRAZIER, POT, BUSH, MOSS = 241, 274, 465, 218
TUFTS = [43, 44, 73, 74]  # grass tufts / flowering plants

# hanging braziers: alley mouth, pit edges, den, arena mouth, vault
for (x, y) in [(25, 62), (47, 64), (63, 64), (86, 60),
               (121, 62), (141, 58), (160, 62)]:
    accent(x, y, BRAZIER)

# pots on the ground / platform tops
for (x, y) in [(5, 69), (21, 69), (44, 69), (76, 69), (99, 69),
               (121, 69), (149, 69), (160, 69)]:
    accent(x, y, POT)

# grass tufts along the breach, den floor, vault
for (x, y) in [(3, 69), (9, 69), (13, 69), (17, 69), (21, 69),
               (75, 69), (80, 69), (89, 69), (95, 69),
               (154, 69), (162, 69)]:
    accent(x, y, rng.choice(TUFTS))

# moss on stone platform tops
for (x, y) in [(29, 63), (39, 59),                    # alley turret platforms
               (51, 65), (57, 62), (63, 65),          # pit hop platforms
               (79, 59), (91, 59),                    # den turret ledges
               (102, 66), (109, 63), (115, 60),       # antechamber steps
               (123, 66), (128, 63), (133, 60),       # arena west + center
               (140, 63), (145, 66)]:                 # arena east steps
    accent(x, y, MOSS)

# bushes at zone seams, tech blocks by the turret ledges (machinery)
accent(23, 69, BUSH)
accent(73, 69, BUSH)
accent(96, 69, BUSH)
accent(76, 56, 72)
accent(77, 56, 189)
accent(93, 56, 72)

# ================================================================ assemble
layers = []
lid = [1]


def tilelayer(name, data):
    layers.append({
        "data": data, "height": H, "id": lid[0], "name": name,
        "opacity": 1, "type": "tilelayer", "visible": True,
        "width": W, "x": 0, "y": 0,
    })
    lid[0] += 1


tilelayer("layer1", layer1)
tilelayer("layer2", layer2)
layers.append({
    "draworder": "topdown", "id": lid[0], "name": "objects",
    "objects": objects, "opacity": 1, "type": "objectgroup",
    "visible": True, "x": 0, "y": 0,
})
lid[0] += 1
tilelayer("walls", walls)
tilelayer("walls2", walls2)

m = {
    "compressionlevel": -1, "height": H, "infinite": False,
    "layers": layers, "nextlayerid": lid[0], "nextobjectid": _next_id[0],
    "orientation": "orthogonal", "renderorder": "right-down",
    "tiledversion": "1.10.2", "tileheight": 32, "tilewidth": 32,
    "tilesets": [{
        "columns": 30, "firstgid": 1, "image": "tilesheet.png",
        "imageheight": 960, "imagewidth": 960, "margin": 0,
        "name": "tilesheet", "spacing": 0, "tilecount": 900,
        "tileheight": 32, "tilewidth": 32,
    }],
    "type": "map", "version": "1.10", "width": W,
}

out = "public/assets/tilemapWorld1.json"
with open(out, "w") as f:
    json.dump(m, f)
print(f"wrote {out}: {len(objects)} objects, {_shard_n[0]} shards, "
      f"{_ckpt_n[0]} checkpoints")

# ---- validation
errors = []
names = {o["name"] for o in objects}
KNOWN = {"spawnPlayer", "spawnCoin", "spawnDuck", "spawnBat", "spawnSunman",
         "spawnBoss", "spawnBoss2", "spawnMiniboss", "spawnShard", "spawnCard", "spawnBooster",
         "spawnDashBuff", "spawnPortal", "spawnSourceBlock", "spawnFinishLine",
         "spawnText", "spawnTurret", "spawnCharger", "spawnBomber",
         "spawnSwarmer", "spawnSpitter",
         "spawnCheckpoint"}
for n in names - KNOWN:
    errors.append(f"unknown spawn name: {n}")
for o in objects:
    if not (0 <= o["x"] < W * 32 and 0 <= o["y"] < H * 32):
        errors.append(f"object out of bounds: {o['name']} at {o['x']},{o['y']}")
    # solid-ground check: enemies/pickups should not spawn inside walls
    if o["name"] in ("spawnDuck", "spawnSunman", "spawnBoss2",
                     "spawnPlayer", "spawnSourceBlock", "spawnTurret",
                     "spawnCharger", "spawnSwarmer", "spawnSpitter"):
        tx, ty = int(o["x"] // 32), int(o["y"] // 32)
        if walls[ty * W + tx] != 0:
            errors.append(f"{o['name']} inside solid wall at tile {tx},{ty}")
ids = [p["value"] for o in objects if o["name"] == "spawnShard"
       for p in o.get("properties", []) if p["name"] == "id"]
if len(ids) != 12 or len(set(ids)) != 12:
    errors.append(f"shard ids wrong: {ids}")
if sorted(ids) != [f"w1-{i:02d}" for i in range(1, 13)]:
    errors.append(f"shard ids not w1-01..w1-12: {sorted(ids)}")
ckpt_idx = sorted(p["value"] for o in objects if o["name"] == "spawnCheckpoint"
                  for p in o.get("properties", []) if p["name"] == "index")
if ckpt_idx != [0, 1, 2, 3]:
    errors.append(f"checkpoint indexes wrong: {ckpt_idx}")
counts = {}
for o in objects:
    counts[o["name"]] = counts.get(o["name"], 0) + 1
for req in ["spawnPlayer", "spawnFinishLine", "spawnBoss2"]:
    if counts.get(req, 0) != 1:
        errors.append(f"expected 1 {req}, got {counts.get(req, 0)}")
for name, want in [("spawnTurret", 5), ("spawnCharger", 4),
                   ("spawnBomber", 2), ("spawnMiniboss", 1),
                   ("spawnSwarmer", 2), ("spawnSpitter", 2),
                   ("spawnCheckpoint", 4)]:
    if counts.get(name, 0) != want:
        errors.append(f"expected {want} {name}, got {counts.get(name, 0)}")
# enemies must not share a tile with any pre-existing object
# (bombers and the mini-boss fly, so they skip the solid-ground check
# above but still must not share a tile). Swarmer packs skip this check
# on purpose: one object spawns three swarmers at half-tile offsets, so
# members can share a tile with a coin — harmless, and the check's
# integer-tile math would false-positive on it.
new_tiles = [(o["name"], o["x"] // 32, o["y"] // 32)
             for o in objects if o["name"] in ("spawnTurret", "spawnCharger",
                                               "spawnBomber", "spawnBoss2",
                                               "spawnMiniboss", "spawnSpitter",
                                               "spawnCheckpoint")]
other_tiles = {(o["x"] // 32, o["y"] // 32)
               for o in objects if o["name"] not in ("spawnTurret", "spawnCharger",
                                                     "spawnBomber", "spawnBoss2",
                                                     "spawnMiniboss", "spawnSpitter",
                                                     "spawnCheckpoint")}
for name, tx, ty in new_tiles:
    if (tx, ty) in other_tiles:
        errors.append(f"{name} overlaps an existing object at tile {tx},{ty}")
print("object counts:", sorted(counts.items()))
if errors:
    print("ERRORS:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("validation OK")
