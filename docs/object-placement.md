# Object placement: what stands where, and why

Design note — not yet built. Written at the end of the session that added the
three regions, so it describes the placement system *as it now is*, the specific
ways it misbehaves, and what to replace it with.

Read this before adding another object type. The reason to do the work is that
every new object currently costs a copy-and-tweak of a nearby block, and the
tweaks have drifted far enough apart that no two object types answer the
question "can this stand here?" the same way.

---

## 1. What exists today

Placement is spread across seven files and two completely different paradigms.

**Pure functions of position** — a coarse cell grid, a hash seeded by
`worldSeed`, and one deterministic answer per cell:

| system | file | cell |
|---|---|---|
| settlements | `world/settlements.js` | 900 |
| farmland | `world/fields.js` | 120 |
| monuments (pyramid, sphinx) | `world/monuments.js` | 2200 |

These are order-independent and stream correctly in any direction. They are the
good pattern.

**Per-chunk dice rolls** — `world/chunks.js` `buildChunk()`, which runs a
sequence of passes, each rolling `Math.random()` a fixed number of times:
animals, crystals, props (tree/cactus/rock), one lone building, a hiker, then
roadside lamps, fuel stations, hoardings and traffic.

Plus three more one-offs: `world/spawn.js` (the landing site, by ring search and
prominence scoring), `world/lane.js` (items of interest, by lane index and a
spiral nudge), and `world/roads.js` (a routed ribbon, its own thing entirely).

### The gates, and how many there are

The same question — *is this ground usable* — is currently asked five different
ways, by five different functions, which do not agree:

| function | file | asks about |
|---|---|---|
| `goodGround(x,z,opts)` | `terrain.js` | water / mountain / canyon / slope / height ceiling |
| `flatEnough(x,z,r)` | `chunks.js` | height spread across a radius |
| `siteOK(x,z,r)` | `settlements.js` | ring-sampled biome, water, road, bridge |
| `siteOK(x,z)` | `monuments.js` | ring-sampled region, biome, slope, spread |
| `landable(x,z,slope,road)` | `spawn.js` | ring-sampled biome, height band, slope, road, settlement |
| `tillable(x,z)` | `fields.js` | biome, height band, slope |

Six, in fact. They overlap heavily and diverge in detail, so "flat enough for a
barn" and "flat enough for a pyramid" are unrelated pieces of code.

Occupancy is separate again: `clearSpot(x,z,r)` in `chunks.js` is the single
gate for the dice-roll passes, testing `inSettlement`, `inField`, `inMonument`,
the spawn disc, and a chunk-local `placed[]` array.

---

## 2. What is actually wrong

Not a wishlist — these are defects with visible consequences.

### 2.1 Occupancy is chunk-local

`const placed=[]` lives inside `buildChunk`. Two objects in **adjacent chunks**
cannot see each other's `mark()`, so nothing prevents a tree in one chunk from
growing through a barn eight metres away in the next. The hash-grid systems are
immune because they are pure functions of position; the dice-roll passes are not.

This is the single most important thing to fix, and fixing it fixes several
others for free.

### 2.2 Order is doing a claim system's job

`buildChunk` places settlements, then fields, then monuments, then animals,
crystals, props, buildings, roads, roadside furniture, traffic — and each pass
routes around what earlier passes claimed. The tell is `clearPropsNear()`, which
**deletes already-placed trees** when a building lands on them. That is not a
placement rule, it is a repair for the absence of one.

Any reordering of those passes silently changes the world.

### 2.3 Footprints are circles

`mark(x,z,r)` claims a disc. A barn is a rectangle, a crop field is a rectangle,
a sphinx is 12 x 33, a road is a ribbon, a pyramid is a square base. A circle
over-reserves across the short axis and under-reserves across the long one — the
sphinx needed a hand-written extra test in `inMonument` precisely because its
disc was the wrong shape.

### 2.4 Nothing is seated except monuments

Only `monuments.js` computes `seatY()` — the lowest ground under the whole
footprint — so the base never hangs in the air. Everything else is placed at
`sample(x,z).h` **at its centre point**, which means any object on a slope has
one edge buried and the opposite edge floating. It is visible on barns and
noticeable on the Area 51 sign.

### 2.5 Density is unmeasurable

Current knobs: `Math.random()<0.32` for a building, `STATION_CHANCE=0.10`,
`dens(LOW_END?6:12)` prop attempts, a `0.92 / 0.42 / 0.30` take-rate by biome.
None of these is comparable to any other, and none answers "how many barns per
square kilometre?" — so tuning a region's feel means hunting constants across
files and re-running by eye.

### 2.6 The region/biome trap keeps recurring

Terrain exposes both a *biome label* (`'plains'`, `'desert'`) and *region
weights* (`wWild`, `wDes`, `wUrb`). The label flips at the middle of the blend;
the weight is what actually says which land you are on. Keying placement off the
label put vultures on ground that was already wilderness underneath — fixed for
the creature table this session, still latent everywhere else.

**Rule: placement keys off region WEIGHT. Terrain appearance keys off the label.**

---

## 3. What to build instead

### 3.1 One declarative spec per object type

The goal is that adding an object is *adding a table row*, not copying a block.
Something in the shape of:

```js
PLACEMENT.barn = {
  footprint : { shape:'rect', w:14, d:10 },   // real extents
  regions   : { wild:1.0, urb:0.25, des:0 },  // by WEIGHT; 0 means never
  ground    : { maxSlope:0.18, maxSpread:2.5, minH:WATER_Y+2, dry:true },
  seat      : 'lowest',                       // lowest | centre | mean
  clear     : { road:12, settlement:20, field:6, monument:50, any:4 },
  density   : { perKm2:1.2 },
  scatter   : 'hash-grid',                    // hash-grid | lane | roadside
};
```

Every field above replaces something currently written as bespoke code. The
placer reads the spec; the object type contributes no placement logic at all.

### 3.2 Everything becomes a pure function of position

Convert the dice-roll passes to hash-grid, exactly as settlements and farmland
already are. Cell size falls out of `density.perKm2`. This kills 2.1 and 2.2
together: adjacent chunks agree because both compute the same answer, and pass
order stops mattering because nothing is claimed *procedurally* any more — a
site either resolves or it does not.

`clearPropsNear()` should be deletable when this lands. If it is not, the
conversion is incomplete.

### 3.3 One ground-fitness function

Collapse the six into one, with the spec's `ground` block as its options:

```js
groundFits(x, z, footprint, groundSpec) -> boolean
```

sampling the real footprint rather than a ring where the shape is rectangular.
The five existing callers become thin wrappers during migration and disappear
after.

### 3.4 Footprints, seating, and clearance as one concept

An object declares its extents once. From that the system derives: the samples
to test for fitness, the polygon to claim, the seat height, and the clearance
test against other claims. Rectangles need an oriented-box overlap test — cheap,
and it is the shape most of these things actually are.

### 3.5 Density in objects per km²

One unit, comparable across every type, tunable per region via the `regions`
weights. It also makes the census below meaningful.

---

## 4. How it gets verified

This is the part that must exist before the tuning starts, because every
placement bug this session was found by measurement and none by looking.

A census harness reporting, per region:

- **objects/km² by type** — against the declared `perKm2`, so the spec is
  checked against reality rather than trusted
- **overlap count** — pairs of claimed footprints that intersect; must be zero,
  *including across chunk boundaries*, which is the 2.1 regression test
- **float/bury** — max height difference between an object's seat and the ground
  under each footprint corner; catches 2.4
- **clearance violations** — objects closer to a road/settlement/field than
  their spec allows
- **rejection reasons** — why candidate sites failed, by cause. This is how the
  farmland tuning was fixed (214 of 440 candidates were dying on the biome test)
  and it is the fastest route to "why is this region empty?"

---

## 5. Build order

Each step is independently shippable and independently verifiable. Do not
attempt this as one change.

1. **Census harness first**, against the *current* system. It will produce a
   baseline and almost certainly find live bugs — expect non-zero cross-chunk
   overlaps immediately.
2. **`groundFits` + footprints**, with the six existing gates rewritten as
   wrappers. Behaviour should not change; the census proves it.
3. **Seating** for everything, not just monuments. Visible improvement, small
   change, no architectural risk.
4. **Global occupancy** — replace chunk-local `placed[]` with a position-derived
   claim. This is the big one; the overlap metric is the pass/fail.
5. **Convert the dice-roll passes to hash-grid**, one type at a time, density
   matched to the baseline census so the world does not visibly change.
6. **Then, and only then, retune** densities per region with the numbers visible.

Steps 1–3 are roughly a session. Step 4 is a session. Step 5 is a session or
more depending on how many types. Step 6 is open-ended and is the fun part.

---

## 6. Open decisions

- **Should scenery become solid?** Villages, fields and hedgerows deliberately
  bypass the `buildings` registry, so the ship flies through them. That was
  right while they were set dressing. With cities coming it will start to feel
  wrong, and retrofitting collision means auditing every clearance radius — so
  it is cheaper to decide before step 5 than after.
- **Do roads join this system or stay separate?** A road is a routed ribbon with
  its own DP cost function; it does not fit the spec shape. It probably stays
  its own thing, but it must publish a claim the placer can test against, which
  it currently does only via `roadDist`.
- **Per-region density overrides, or one global number scaled by region weight?**
  The spec above assumes the latter. The former is more expressive and more
  knobs to get wrong.
- **Does the lane get spec'd too?** Items of interest are placed by lane index
  with a spiral nudge (`world/lane.js`). It could become `scatter:'lane'` in the
  same table, or stay separate because its constraint is *ordering*, not
  density.
