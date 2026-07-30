/* =========================================================================
   CONSTANTS — world sizing + custom-asset manifest.

   ASSETS: set a url to null to keep the built-in procedural version. Files
   live next to index.html (models/ + textures/). Tune scale/rot/lift by eye.
   OBJ_SCALE multiplies everything that stands on the ground.

   FACING CONVENTION: +Z is forward for everything that moves. All movement
   code steers with atan2(dx, dz) and steps along (sin y, cos y), and the
   procedural creatures are all modelled nose-at-+Z. So rotY on a creature must
   leave its nose pointing +Z — a wrong rotY makes the animal travel tail-first
   rather than merely look rotated. Static scenery (tree/barn/crystal) has no
   facing and rotY there is purely cosmetic.
   ========================================================================= */
export const OBJ_SCALE = 1.35;

export const WATER_Y = -3;
export const CHUNK = 80, SEG = 28;   // terrain tessellation per chunk (desktop). Finer than
                                     // the old 14 so slopes and lake shorelines read smoother
                                     // (~2.9 u/facet vs 5.7). Mobile uses a lower value in
                                     // chunks.js to keep the per-chunk build cheap. The height
                                     // field is long-wavelength, so physics (analytic heightAt)
                                     // is unchanged; only the visible tessellation gets denser.

/* Hover altitude, in world units above the terrain directly below the ship.
   HOVER_BASE is the resting height the ship has always flown at; arrow up/down
   (or a vertical swipe on touch) moves S.hover between HOVER_MIN (skimming the
   surface — the crash floor is ground+2.5, so this keeps a little clearance)
   and HOVER_MAX (3x base). The rate is momentum-driven, see the flight-feel
   constants below. */
export const HOVER_BASE = 15, HOVER_MIN = 4, HOVER_MAX = HOVER_BASE * 3;

/* ---- Flight feel (a HEAVY, massive craft — momentum over agility) ----
   Nothing is commanded instantly. Translation, altitude and heading each feed a
   *rate* that accelerates while an input is held, coasts to a stop through its
   own drag, and is capped. The ship is deliberately ponderous: a low ACC means
   it takes a full beat to spool up rather than leaping off the mark, and a
   higher DRAG retention (closer to 1) lets that built momentum glide on when you
   let go — so it reads as tonnes of alien metal, not a cursor. Top speed is kept
   roughly where it was; only the *time* to reach or shed it has grown.
   Bump the ACC/VMAX values for more agility; raise the DRAG retentions for more
   glide/float. */
export const MOVE_ACC   = 98;    // horizontal thrust accel, world units/s^2 (agile: responds hard to the stick)
export const BEAM_MOVE  = 0.22;  // thrust multiplier while the beam is open — the ship
                                 // crawls while feeding so it's easy to lock and hover
                                 // over a target (paired with BEAM_MAXSPEED below).
export const BEAM_MAXSPEED = 0.28; // top-speed multiplier while beaming — hard-caps drift
                                   // so momentum can't carry the ship off the target.

export const HOVER_ACC  = 68;    // world units/s^2 added to the climb rate while held (snappy altitude)
export const HOVER_DRAG = 0.10;  // per-second retention of climb rate when released (settles quickly)
export const HOVER_VMAX = 28;    // max climb/dive rate, world units/s (quick to gain height)

/* Ship heading. ← / → (desktop) or the right joystick x-axis (touch) push an
   angular acceleration onto S.yawV, which coasts down through YAW_DRAG and is
   capped at YAW_VMAX. The whole flight frame (translation + chase camera)
   rotates with S.yaw, so the ship reads as an object banking through the air.
   Turning is now slow and weighty: a low ACC gives the input a moment of delay
   before the nose starts to come round, a higher DRAG lets the swing carry, and
   a lower VMAX caps how fast such a big disc can rotate. */
export const YAW_ACC  = 5.6;     // rad/s^2 added to spin rate while turning (agile: the nose comes round fast)
export const YAW_DRAG = 0.10;    // per-second retention of spin rate when released (settles quickly, little coast)
export const YAW_VMAX = 2.6;     // max yaw rate, rad/s (turns briskly)

/* Ship collision radius. Deliberately under the ~5u visual hull so glancing
   passes read as near-misses rather than unfair phantom hits. */
export const SHIP_R = 4.0;

/* Terrain above this height reads as a MOUNTAIN and is solid — flying into it at
   low altitude crashes the ship. Hills (below it) are ridden over as before, and
   a high enough hover still clears a peak. Earth hills top out ~18 while mountain
   terrain climbs past 26 into snow at 36+, so this cleanly splits the two. */
export const MTN_H = 26;

/* Chase-camera distance/height scale by altitude: descending pulls the camera
   in tight, climbing pulls it back for a wider view. 1.0 at HOVER_BASE. */
export const CAM_ZOOM_LOW = 0.62, CAM_ZOOM_HIGH = 1.5;

/* Altitude trade-off. All three ramps read 1.0 at HOVER_BASE, so resting
   flight behaves exactly as before and only leaving that height changes things.

   Fly low: the beam bites harder and costs less, but trees and barns are lethal.
   Fly high: safe from obstacles, but locks crawl and the reactor bleeds.
   BEAM_STR is a direct multiplier on lock progress; DRAIN_ALT multiplies the
   whole energy drain rate. */
export const BEAM_STR_LOW = 1.35, BEAM_STR_HIGH = 0.35;
export const DRAIN_ALT_LOW = 0.80, DRAIN_ALT_HIGH = 2.20;

/* How many times each ground texture tiles across one CHUNK. Lower = zoomed in
   (bigger features); higher = more repetition. One tile spans CHUNK/tiling
   world units.

   These are tuned per texture because the source images differ hugely in
   resolution, and sharpness is texels-per-world-unit = resolution*tiling/CHUNK.
   grass.jpg is 4500px and can be zoomed hard while staying crisp; sand.jpg is
   only 1000px, so zooming it as far would just magnify blur. The values below
   trade a little extra repetition on sand/rock for detail that actually holds
   up. Retune if you swap in higher-resolution art.

   NOTE: this is what actually controls ground tiling — the `repeat` fields on
   the texture entries below do not apply, since the terrain shader in
   world/chunks.js builds its own UVs. */
export const GROUND_TILING = {
  grass: 6.0,    // 4500px source -> ~337 texels/unit
  sand:  11.0,   // 1000px source -> ~138 texels/unit
  rock:   9.0,   // 1600px source -> ~180 texels/unit
  snow:   6.0,   // procedural 256px, no source detail to preserve
};

export const ASSETS = {
  saucer:  { url:'models/saucer.glb',    scale:5.0, rotY:0,        yOffset:0, seat:false },
  sheep:   { url:'models/sheep.glb',     scale:1.0, rotY:0,        yOffset:0 },
  duck:    { url:'models/duck.glb',      scale:1.0, rotY:0,        yOffset:0 },
  camel:   { url:'models/camel.glb',     scale:1.0, rotY:0,        yOffset:0 },
  goat:    { url:'models/goat.glb',      scale:1.0, rotY:0,        yOffset:0 },
  grass:   { url:'textures/grass.jpg',   repeat:6 },
  mountain:{ url:'textures/mountain.jpg', repeat:5 },
  sand:    { url:'textures/sand.jpg',    repeat:6 },
  crystal: { url:'models/crystal.glb',   scale:1.0, rotY:0,        yOffset:0 },
  barn:    { url:'models/barn.glb',      scale:2.0, rotY:0,        yOffset:0 },
  hiker:   { url:'models/hiker.glb',     scale:1.0, rotY:0,        yOffset:0 },
  tree:    { url:'models/tree.glb',      scale:2.0, rotY:0,        yOffset:0 },
  // Roadside set. Missing files degrade to the procedural shapes in
  // entities/vehicles.js and entities/stations.js, so these can be dropped in
  // later without any code change. Vehicles move, so their rotY must leave the
  // nose at +Z — see the FACING CONVENTION note above.
  gas_station:{ url:'models/gas_station.glb', scale:2.2, rotY:0,   yOffset:0 },
  car1:    { url:'models/car1.glb',      scale:1.0, rotY:0,        yOffset:0 },
  car2:    { url:'models/car2.glb',      scale:1.0, rotY:0,        yOffset:0 },
  bus1:    { url:'models/bus1.glb',      scale:1.0, rotY:0,        yOffset:0 },
};

/* Roadside population, per chunk that contains road. */
/* Global multiplier on how much a chunk spawns (creatures, crystals, scenery,
   traffic). Lower = fewer live objects, which means less GPU memory held at any
   moment and less churn as chunks stream. 0.7 = 30% lighter than the original
   tuning. This is the one knob for world density; see world/chunks.js. */
export const SPAWN_DENSITY = 0.7;

export const VEH_PER_CHUNK = 1;      // attempts per road-bearing chunk (~55% take)
export const VEH_STOP_R    = 26;     // ship within this radius -> traffic halts
export const STATION_CHANCE= 0.10;   // chance a road-bearing chunk gets a station
export const PROP_ROAD_GAP = 4.5;    // clear verge kept either side of the tarmac
