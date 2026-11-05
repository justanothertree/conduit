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

Layout (tiles, 32px; map is 140x80, y grows downward):
  A  Breach        x  2-22    spawn, checkpoint 0, ducks, sign, secret hop
  B  Turret alley  x 24-46    2 turrets on platforms, cover blocks, charger,
                             checkpoint 1 at the exit
  C  The pit       x 48-72    lava pit with platform hops, bats, turret on
                             the far shore, checkpoint 2 at the exit
  D  Charger den   x 74-106   open arena: 3 chargers, 2 turrets on ledges,
                             cover blocks, antechamber with checkpoint 3
  E  Boss arena    x 108-130  Iron Warden (boss 2), cover, ground doorway in
                             the left wall, climb-out over the right wall
  F  Vault         x 131-138  finish line, Home return portal, card, shard

Layers match the other maps: layer1 (empty — the nebula sky shows
through), layer2 (background accents in Krazay17's tilemap2 style —
braziers, pots, grass, moss, bushes, tech blocks, never colliding),
objects, walls (stone 157, collides), walls2 (lava 329/330,
fire damage). Tileset "tilesheet" (32px tiles).
"""
import json
import sys

W, H = 140, 80
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
rect(walls, 138, 0, 139, H - 1, STONE)

# ---- A: breach
rect(walls, 2, 70, 22, 79, STONE)
add("spawnPlayer", 8, 66)
add("spawnText", 6, 61, text="WORLD 1")
checkpoint(11, 66)                       # checkpoint 0: the start
add("spawnDuck", 15, 66)
add("spawnDuck", 19, 66)
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
add("spawnBat", 54, 56)
add("spawnBat", 60, 52)
coin_line(50, 62, 54, 59, 3, float_=True)
coin_line(58, 59, 62, 62, 3, float_=True)
shard(57, 57)                            # w1-05: mid-air over the pit
shard(51, 71)                            # w1-06: low over the lava (risk)
checkpoint(70, 66)                       # checkpoint 2: pit crossed

# ---- D: charger den
rect(walls, 74, 70, 98, 79, STONE)
platform(78, 60, 3)
add("spawnTurret", 79, 56)               # turret 4 on the west ledge
platform(90, 60, 3)
add("spawnTurret", 91, 56)               # turret 5 on the east ledge
add("spawnCharger", 81, 66)
add("spawnCharger", 87, 66)
add("spawnCharger", 93, 66)
add("spawnSourceBlock", 84, 66)          # cover
add("spawnSourceBlock", 96, 66)          # cover
for i in range(76, 97, 2):
    coin(i, 66)
shard(86, 52)                            # w1-07: high over the den
shard(97, 64)                            # w1-08: east corner
# antechamber before the boss
rect(walls, 99, 70, 106, 79, STONE)
add("spawnText", 101, 62, text="BOSS AHEAD")
add("spawnDashBuff", 103, 66)
checkpoint(104, 66)                      # checkpoint 3: boss antechamber

# ---- E: boss arena (Iron Warden)
rect(walls, 108, 70, 130, 79, STONE)     # floor
rect(walls, 106, 56, 107, 67, STONE)     # left wall with a ground doorway
rect(walls, 128, 60, 129, 69, STONE)     # right wall (climb out over it)
for (px, py) in [(112, 62), (120, 62)]:
    platform(px, py, 4)                  # cover
platform(124, 64, 4)                     # exit step to the right wall top
add("spawnBoss2", 119, 64, props=[prop("health", "int", 600)])
for i in range(110, 127, 2):
    coin(i, 66)
shard(113, 58)                           # w1-09: above west cover
shard(126, 58)                           # w1-10: east corner
shard(119, 54)                           # w1-11: high center (risk)

# ---- F: vault
rect(walls, 131, 70, 138, 79, STONE)
add("spawnFinishLine", 135, 66)
add("spawnCard", 136, 62, props=[prop("float", "bool", True)])
for i in range(132, 137, 2):
    coin(i, 66)
shard(134, 62)                           # w1-12: the vault

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
               (107, 62), (126, 62), (134, 62)]:
    accent(x, y, BRAZIER)

# pots on the ground / platform tops
for (x, y) in [(5, 69), (21, 69), (44, 69), (76, 69), (97, 69),
               (110, 69), (129, 69), (137, 69)]:
    accent(x, y, POT)

# grass tufts along the breach, den floor, vault
for (x, y) in [(3, 69), (9, 69), (13, 69), (17, 69), (21, 69),
               (75, 69), (80, 69), (89, 69), (95, 69),
               (132, 69), (136, 69)]:
    accent(x, y, rng.choice(TUFTS))

# moss on stone platform tops
for (x, y) in [(29, 63), (39, 59),                    # alley turret platforms
               (51, 65), (57, 62), (63, 65),          # pit hop platforms
               (79, 59), (91, 59),                    # den turret ledges
               (113, 61), (121, 61), (125, 63)]:      # arena cover + exit step
    accent(x, y, MOSS)

# bushes at zone seams, tech blocks by the turret ledges (machinery)
accent(23, 69, BUSH)
accent(73, 69, BUSH)
accent(105, 69, BUSH)
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
         "spawnBoss", "spawnBoss2", "spawnShard", "spawnCard", "spawnBooster",
         "spawnDashBuff", "spawnPortal", "spawnSourceBlock", "spawnFinishLine",
         "spawnText", "spawnTurret", "spawnCharger", "spawnCheckpoint"}
for n in names - KNOWN:
    errors.append(f"unknown spawn name: {n}")
for o in objects:
    if not (0 <= o["x"] < W * 32 and 0 <= o["y"] < H * 32):
        errors.append(f"object out of bounds: {o['name']} at {o['x']},{o['y']}")
    # solid-ground check: enemies/pickups should not spawn inside walls
    if o["name"] in ("spawnDuck", "spawnSunman", "spawnBoss2",
                     "spawnPlayer", "spawnSourceBlock", "spawnTurret",
                     "spawnCharger"):
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
                   ("spawnCheckpoint", 4)]:
    if counts.get(name, 0) != want:
        errors.append(f"expected {want} {name}, got {counts.get(name, 0)}")
# enemies must not share a tile with any pre-existing object
new_tiles = [(o["name"], o["x"] // 32, o["y"] // 32)
             for o in objects if o["name"] in ("spawnTurret", "spawnCharger",
                                               "spawnBoss2", "spawnCheckpoint")]
other_tiles = {(o["x"] // 32, o["y"] // 32)
               for o in objects if o["name"] not in ("spawnTurret", "spawnCharger",
                                                     "spawnBoss2", "spawnCheckpoint")}
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
