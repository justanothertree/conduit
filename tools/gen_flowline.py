#!/usr/bin/env python3
"""Generate public/assets/tilemapFlow.json — the FLOWLINE level for Conduit.

FLOWLINE is a movement-showcase level: a flowing left-to-right gauntlet
with a safe route and a faster booster highway, a wall-jump canyon, a
boss arena, and a summit finish with a race timer. 12 shards are
hidden along the flow line, in secrets, and off the speed route.

Movement calibration (read from the player code, not changed):
  full held jump ~= 125px (~4 tiles), dash speed 900, wall jump exists.
  Design rule: vertical steps <= 3 tiles, horizontal gaps <= 6 (dashable).

Layout (tiles, 32px; map is 160x100, y grows downward):
  A  Start meadow      x  2-24    spawn, sign, first shard, secret staircase, charger
  B  Descent           x 26-58    platform hops over a lava pit, bats, turret guarding the exit
  C  Wall canyon       x 74-94    wall-jump shaft, sunmen, secret alcove+portal, turret on exit, charger on floor
  D  Lava lake         x100-134   booster highway (speed) or top platforms (safe), turret on safe route
  E  Boss arena        x136-157   first real boss, cover, risk/reward shards, charger on entry platform
  F  Summit climb      x138-157   zigzag to the plateau, finish line

Layers match the other maps: layer1, layer2 (background — sparse cave-rock
speckle and foreground accents in Krazay17's tilemap2 style, never colliding),
objects, walls (stone 157, collides), walls2 (lava 329/330,
fire damage). Tileset "tilesheet" (32px tiles).
"""
import json
import sys

W, H = 160, 100
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
        props=[prop("id", "string", f"flow-{_shard_n[0]:02d}")])


# ================================================================ geometry
# borders
rect(walls, 0, 0, 1, H - 1, STONE)
rect(walls, 158, 0, 159, H - 1, STONE)

# ---- A: start meadow
rect(walls, 2, 82, 24, 99, STONE)
for (sx, sy) in [(2, 79), (2, 76), (2, 73), (2, 70)]:  # secret staircase
    platform(sx, sy, 4)
add("spawnPlayer", 10, 78)
add("spawnText", 8, 73, text="FLOWLINE")
for i in range(8, 21, 2):
    coin(i, 77)
shard(18, 75)                            # flow-01: on the path
shard(3, 68)                             # flow-02: top of the staircase

# ---- B: descent over lava pit
for (px, py) in [(28, 78), (36, 75), (44, 72), (52, 69)]:
    platform(px, py, 6)
rect(walls2, 26, 96, 58, 99, LAVA)
add("spawnBat", 34, 62)
add("spawnBat", 48, 58)
coin_line(30, 74, 34, 71, 3, float_=True)
coin_line(38, 71, 42, 68, 3, float_=True)
coin_line(46, 68, 50, 65, 3, float_=True)
shard(40, 66)                            # flow-03: mid-air on the descent

# ---- C: wall-jump canyon (interior x76-91, walls at 74-75 and 92-93)
rect(walls, 58, 80, 98, 99, STONE)        # valley + canyon floor
rect(walls, 74, 48, 75, 79, STONE)        # left wall
rect(walls, 92, 48, 93, 79, STONE)        # right wall
rect(walls, 92, 70, 93, 72, 0)            # carve secret alcove
add("spawnDuck", 62, 76)
add("spawnDuck", 68, 76)
for i in range(60, 75, 2):
    coin(i, 76)
for (px, py) in [(78, 70), (86, 61), (78, 52)]:   # rest ledges
    platform(px, py, 4)
platform(92, 48, 9)                      # exit platform (x92-100)
add("spawnSunman", 82, 76)
add("spawnSunman", 88, 76)
add("spawnDashBuff", 77, 76)
add("spawnSourceBlock", 84, 76)
for i in range(78, 92, 3):
    coin(i, 76)
coin(80, 66)
coin(88, 57)
shard(99, 46)                            # flow-04: hop off the exit platform
shard(92, 70)                            # flow-05: secret alcove
add("spawnPortal", 93, 71, props=[
    prop("index", "int", 1), prop("otherPortal", "int", 2),
    prop("color", "int", 0x00FFFF)])

# ---- D: lava lake — booster highway (fast) or top platforms (safe)
rect(walls2, 100, 90, 134, 99, LAVA)
rect(walls2, 104, 90, 106, 92, LAVA2)
rect(walls2, 118, 90, 120, 92, LAVA2)
for (px, py) in [(103, 82), (111, 78), (119, 74)]:
    platform(px, py, 3)                  # safety pillars
add("spawnBooster", 103, 74, rotation=90, props=[prop("power", "int", 1200)])
add("spawnBooster", 111, 70, rotation=90, props=[prop("power", "int", 1200)])
add("spawnBooster", 119, 66, rotation=45, props=[prop("power", "int", 1300)])
for (px, py) in [(108, 50), (116, 53), (124, 56)]:
    platform(px, py, 5)                  # safe route
add("spawnBat", 108, 62)
add("spawnBat", 118, 58)
coin_line(104, 68, 120, 60, 6, float_=True)
shard(126, 54)                           # flow-06: in the booster arc
rect(walls, 128, 80, 136, 99, STONE)     # far shore

# ---- E: boss arena (enter over the left wall, exit up the right)
rect(walls, 136, 84, 157, 99, STONE)     # floor
rect(walls, 136, 62, 137, 83, STONE)     # left wall
rect(walls, 155, 70, 156, 83, STONE)     # right wall (short — climb out)
platform(132, 58, 10)                    # entry platform (x132-141)
add("spawnText", 134, 55, text="BOSS AHEAD")
add("spawnDashBuff", 134, 54)
for (px, py) in [(140, 74), (148, 74)]:
    platform(px, py, 4)                  # cover
for (px, py) in [(152, 76), (152, 68)]:
    platform(px, py, 3)                  # exit ledges on the right wall
add("spawnBoss", 147, 78, props=[prop("health", "int", 500)])
add("spawnDuck", 140, 80)
add("spawnDuck", 152, 80)
add("spawnSourceBlock", 142, 80)
for i in range(138, 155, 2):
    coin(i, 80)
shard(138, 80)                           # flow-07: arena corner
shard(153, 80)                           # flow-08: arena corner

# ---- F: summit zigzag (3-tile steps) to the plateau
for (px, py) in [(152, 67), (147, 64), (152, 61), (147, 58), (152, 55),
                 (147, 52), (152, 49), (147, 46), (138, 43)]:
    platform(px, py, 4)
rect(walls, 142, 40, 157, 43, STONE)     # summit plateau (top y40)
add("spawnFinishLine", 150, 36)
add("spawnPortal", 144, 38, props=[
    prop("index", "int", 2), prop("otherPortal", "int", 1),
    prop("color", "int", 0x00FFFF)])
add("spawnCard", 152, 32, props=[prop("float", "bool", True)])
shard(147, 60)                           # flow-09: the climb
shard(152, 50)                           # flow-10: the climb
shard(146, 36)                           # flow-11: summit
shard(155, 36)                           # flow-12: summit edge

# ================================================================ new enemies
# Turrets guard chokepoints (stationary, telegraph then fire aimed fireballs).
# Chargers roam open platforms (patrol, then telegraph and dash at the
# player, shielded from the front while walking). Kept clear of the boss
# arena, shard positions, spawn point, and portals. Turrets sit on top of
# the named platform: TurretPlatform.png is 135px tall, so ty puts the
# sprite base ~on the platform top.
add("spawnTurret", 54, 65)               # guards the descent exit, on platform (52,69)
add("spawnTurret", 95, 44)               # guards the canyon exit platform (92,48)
add("spawnTurret", 118, 49)              # guards the safe route, on platform (116,53)
add("spawnCharger", 16, 80)              # open meadow floor
add("spawnCharger", 70, 78)              # canyon floor
add("spawnCharger", 138, 56)             # boss entry platform (132,58)

# ================================================================ decoration
# layer1/layer2 are pure background: setupTileMap only ever collides
# walls/walls2, so tiles here can't affect gameplay, collision, or spawns.
# Style follows Krazay17's tilemap2 — dark cave-speckle noise on layer1,
# sparse foreground accents (grass, pots, braziers) on layer2. All gids
# below already exist in the tileset. The nebula sky stays dominant:
# speckle is sparse clusters, not a full fill.
import random
rng = random.Random(20261101)  # deterministic — regen is byte-identical

SPECKLE = [783, 788, 815, 816, 817, 818, 845, 846]  # dark cave rock
reserved = {(o["x"] // 32, o["y"] // 32) for o in objects}


def open_air(x, y):
    return (0 <= x < W and 0 <= y < H
            and walls[y * W + x] == 0 and walls2[y * W + x] == 0
            and (x, y) not in reserved)


def speckle(x0, y0, x1, y1, density):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if open_air(x, y) and rng.random() < density:
                set_tile(layer1, x, y, rng.choice(SPECKLE))


# distant dark rock behind the open areas
speckle(76, 49, 91, 78, 0.10)     # canyon shaft interior
speckle(26, 84, 58, 95, 0.08)     # above the lava pit
speckle(100, 60, 134, 88, 0.05)   # lava lake backdrop
speckle(138, 63, 154, 82, 0.08)   # boss arena backdrop
speckle(142, 28, 157, 38, 0.06)   # summit cliff backdrop


def accent(x, y, gid):
    if open_air(x, y):
        set_tile(layer2, x, y, gid)


BRAZIER, POT, BUSH, MOSS = 241, 274, 465, 218
TUFTS = [43, 44, 73, 74]  # grass tufts / flowering plants

# hanging braziers: canyon shaft, arena mouth, summit
for (x, y) in [(84, 55), (82, 66), (140, 66), (150, 33)]:
    accent(x, y, BRAZIER)

# pots on the ground / platform tops
for (x, y) in [(6, 81), (22, 81), (70, 79), (139, 83), (154, 83), (156, 39)]:
    accent(x, y, POT)

# grass tufts along the meadow, canyon floor, summit plateau
for (x, y) in [(3, 81), (9, 81), (13, 81), (17, 81), (23, 81),
               (60, 79), (66, 79), (72, 79),
               (143, 39), (147, 39), (151, 39)]:
    accent(x, y, rng.choice(TUFTS))

# moss on stone platform tops
for (x, y) in [(30, 77), (38, 74), (46, 71),        # descent platforms
               (113, 77), (121, 73),                # booster pillars
               (141, 73), (149, 73), (153, 75)]:    # arena cover + exit ledge
    accent(x, y, MOSS)

# bush at the meadow edge, tech blocks by the first booster (machinery)
accent(24, 81, BUSH)
accent(138, 83, BUSH)
accent(101, 60, 72)
accent(102, 60, 189)

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

out = "public/assets/tilemapFlow.json"
with open(out, "w") as f:
    json.dump(m, f)
print(f"wrote {out}: {len(objects)} objects, {_shard_n[0]} shards")

# ---- validation
errors = []
names = {o["name"] for o in objects}
KNOWN = {"spawnPlayer", "spawnCoin", "spawnDuck", "spawnBat", "spawnSunman",
         "spawnBoss", "spawnShard", "spawnCard", "spawnBooster",
         "spawnDashBuff", "spawnPortal", "spawnSourceBlock", "spawnFinishLine",
         "spawnText", "spawnTurret", "spawnCharger"}
for n in names - KNOWN:
    errors.append(f"unknown spawn name: {n}")
for o in objects:
    if not (0 <= o["x"] < W * 32 and 0 <= o["y"] < H * 32):
        errors.append(f"object out of bounds: {o['name']} at {o['x']},{o['y']}")
    # solid-ground check: enemies/pickups should not spawn inside walls
    if o["name"] in ("spawnDuck", "spawnSunman", "spawnBoss",
                     "spawnPlayer", "spawnSourceBlock"):
        tx, ty = int(o["x"] // 32), int(o["y"] // 32)
        if walls[ty * W + tx] != 0:
            errors.append(f"{o['name']} inside solid wall at tile {tx},{ty}")
ids = [p["value"] for o in objects if o["name"] == "spawnShard"
       for p in o.get("properties", []) if p["name"] == "id"]
if len(ids) != 12 or len(set(ids)) != 12:
    errors.append(f"shard ids wrong: {ids}")
counts = {}
for o in objects:
    counts[o["name"]] = counts.get(o["name"], 0) + 1
for req in ["spawnPlayer", "spawnFinishLine", "spawnBoss"]:
    if counts.get(req, 0) != 1:
        errors.append(f"expected 1 {req}, got {counts.get(req, 0)}")
for name, want in [("spawnTurret", 3), ("spawnCharger", 3)]:
    if counts.get(name, 0) != want:
        errors.append(f"expected {want} {name}, got {counts.get(name, 0)}")
# new enemies must not share a tile with any pre-existing object
new_tiles = [(o["name"], o["x"] // 32, o["y"] // 32)
             for o in objects if o["name"] in ("spawnTurret", "spawnCharger")]
other_tiles = {(o["x"] // 32, o["y"] // 32)
               for o in objects if o["name"] not in ("spawnTurret", "spawnCharger")}
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
