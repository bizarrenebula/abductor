# ABDUCTOR

play link:
https://abductor.lol

A dark, atmospheric 3D flying-saucer game that runs entirely in the browser. Pilot a UFO over an endless, procedurally generated wilderness, lower your tractor beam, and harvest the local wildlife — while managing your reactor, dodging the daylight, and unravelling the fate of a fallen mothership.

Built as a single HTML file with [Three.js](https://threejs.org/), so it deploys straight to GitHub Pages with no build step. Optional 3D models and textures load from an assets folder on desktop, with procedural fallbacks everywhere.

---

## Play

Open the deployed page (GitHub Pages), wait for the splash screen to finish loading, and press **PLAY**.

On desktop it loads the full 3D models and textures. On phones it runs a lighter, fully procedural version for speed — with an optional **High detail** toggle in the setup screen if you want to load everything anyway.

---

## The idea

You fly a saucer above an infinite landscape of grasslands, deserts, highlands and wetlands. Every region has its own animals. To abduct one, hold your **tractor beam** over it long enough for the lock to complete — but the animals feel the light and bolt one step at random, and a single step out of the beam resets the lock. Read the herd, predict the hop, and keep them centred: the closer an animal is to the beam's heart, the faster it lifts.

It's part reflex, part patience, part risk management — every second you spend beaming is a second your reactor is draining and the sun might be coming up.

---

## Controls

**Fly** — drag anywhere (touch) or `WASD` / arrow keys (desktop).
**Beam** — double-tap-and-hold (touch), or hold click / `Space` (desktop). The ship flies slower while the beam is open.
**The Pull** — the charged circular button (or `Q`): drags every nearby creature under the saucer for as long as you hold it.
**Cloak** — tap directly on the saucer to toggle invisibility.

The saucer has real inertia — it drifts, banks into turns, and coasts to a stop.

---

## What you'll find

**Animals** are worth points by rarity — sheep are common and cheap, ducks and camels worth more, goats the most valuable regular catch.

**Energy crystals** glow, half-buried, in scattered deposits. Harvest them with the beam like animals to refuel your reactor. On Earth they're green; each world has its own colour.

**Humans** — hikers and villagers near barns and campsites — are the richest prize, but they *see you*. Approach in daylight and they sprint for the nearest building and hide. Catch them at night, or under cloak, when they're blind to everything but an active beam. Catching one is a bonus, never required.

**Props** — trees, rocks, cacti — are just scenery; the beam destroys them, and dropped humans fall back to earth.

---

## Systems

### Energy & crashing
In **drainable** mode (toggleable in settings) your reactor bleeds while you fly, faster while beaming, pulling, or cloaked. A floating green bar above the saucer shows the level; warnings fire at 50%, 25% and below 10%, nudging you toward crystals. Hit zero and the ship falls out of the sky — game over. You can also choose **infinite** energy to just explore.

### Day & night
Each session cycles between day and night — switching at the halfway mark of a timed run, or every five minutes on an infinite one, announced with a **DAYBREAK / NIGHTFALL** banner.

- **Day** — the sun shines warm and bright, with occasional lens flares. Animals move faster, the ship is fully visible, and hikers spot you from afar. Your saucer flies slower.
- **Night** — the moon lights the land and reflects in the water, the ship's running lights glow brighter and its border lights blink. Animals slow down, hikers are effectively blind until your beam gives you away, and the saucer flies faster.

### Weather
Regions carry their own conditions — rain, sandstorms, snow storms, fog — that reduce your beam's effectiveness and, in the storms, your visibility. Watch the readout for the current penalty.

### The Pull
A special power that fills as you collect (or over time). When charged, hold it to sweep every nearby creature toward the saucer at once — the beam auto-fires so they start locking immediately.

### Cloak
Tap the saucer to turn semi-transparent. Hikers can't see a cloaked ship — during the day this lets you drift right up to them — but it drains energy fast, so it's a deliberate gamble.

### Buffs
Every few abductions grants a temporary boon: faster engines, faster lock, or a wider beam. Completing side-quest contracts grants longer ones, and clearing them all in a session pays a bonus.

### Ship upgrades
The third progression perk, always on in both Story and Exploration. Your saucer starts **grounded** — locked to its resting altitude, standard engines, a basic beam, and no cloak — and earns its way to "hero" in a few minutes, two ways at once:

- **The collect ladder** — everything you beam up (animals, crystals, humans) feeds a point pool that gradually widens the tractor beam and, at the summit, unlocks the **cloak** (the highest achievement).
- **Field parts** — the **Thrusters** (unlock climb/dive) and the **High-End Engine** (+25% thrust) are scattered far apart at random spots on the map, flagged on the radar, and blinking when they fall in your line of sight. Fly over one to install it.

Every upgrade banks a **save point**: a crash or a disaster hit never costs you the ship you've earned — a Story respawn keeps it, and "run it back" after a fatal run in Exploration restores it. Only a fresh session from the menu starts you grounded again. Each upgrade greets you with a cheerful on-screen card telling you what it grants and how to use it.

### Missions
A rolling contract tracks a current objective — take 5 sheep, then 5 of each animal, then 5 crystals, then a human — each paying out on completion. Moon and Mars have their own contract chains.

---

## Worlds

Choose your world in the setup screen:

- **Earth** — grass, water, deserts and snow-capped highlands, with sheep, ducks, camels, goats, plus humans and buildings.
- **Moon** — a near-black airless waste of craters, home to drifting **blobs**, scuttling **crawlers**, and fast low-flying **skimmers**. The saucer is noticeably faster and more agile in low gravity.
- **Mars** — a red dust world of mesas and storms, prowled by tripod **striders**, rolling spiked **tumblers**, and burrowing **wormlings**. Meteor showers rain down — a direct hit is instantly fatal.

### Story mode (Earth only)
An optional three-act arc:

1. **Find the signal** — follow a trail of burning debris to a crashed mothership.
2. **Repair the hull** — gather crystal, water and sand from across the map (beacon-marked) and return.
3. **Wake the core** — feed her 50 energy crystals to bring her back online.

Each act ends with a stats screen. The main path is completable on your starting fuel — detour to hunt animals and you'll need to refuel.

### Minimap
A round radar in the corner shows your surroundings, with green blips for crystals and coloured markers for story objectives; off-range points cling to the rim as direction hints.

---

## Audio

Two music sources, switchable in settings (**Music: Soundtrack / Procedural**):

- **Soundtrack** (default) — a bundled orchestral track (`audio/soundtrack.mp3`), looped.
- **Procedural** — the original live-synthesized, per-world themes: ambient dread on Earth, a vast empty drift on the Moon, a driving pulse on Mars.

Over either source, a synthesized **theremin** wails and glides for that 50s/80s alien-movie (*Mars Attacks!*) atmosphere. The rest is still synthesized live — no files:

- The **beam** ignites, hums while it feeds, and powers down.
- Abducted creatures let out a short, sharp **cry**.

The bundled MP3 is the only audio asset; if it fails to load, the game falls back to the procedural engine, so there's always music.

(iOS note: audio needs one tap to unlock, and plays even with the silent switch on.)

---

## Running it yourself

It's a single `index.html`. To host on **GitHub Pages**: put the file in a repo, enable Pages, done.

For the full-detail desktop visuals, add the optional asset folders next to `index.html`:

```
index.html
models/    saucer.glb, sheep.glb, duck.glb, camel.glb, goat.glb,
           crystal.glb, barn.glb, hiker.glb, tree.glb
textures/  grass.jpg, mountain.jpg, sand.jpg
```

Filenames are case-sensitive on GitHub Pages — keep them lowercase. Missing files simply fall back to built-in procedural shapes and canvas textures, so the game always runs.

---

## Changelog (major milestones)

**Foundations**
- Infinite chunked terrain with grassland / desert / highland / wetland biomes, rivers and lakes.
- Physics-driven saucer with inertia and banking; glowing cone tractor beam with a ground impact disc.
- Core abduction loop: hold-to-lock with random animal hops; per-region animals.

**Feel & atmosphere**
- Dark, cinematic art direction (Inside / Limbo / Badland), later pushed to an eerier, creepier tone.
- Per-region weather affecting abduction and visibility.
- Difficulty settings: lock time, beam diameter, session length (1 min–infinite).
- Center-weighted lock speed; smaller, faster-changing biomes.

**Progression & rewards**
- Rarity-based scoring, temporary buffs, and the "Pull" special power.
- Zero-to-hero ship upgrades: a collect-driven beam/cloak ladder plus map-found parts (thrusters, high-end engine), with save points that survive crashes.
- Energy reactor with crystal refuelling and crash-on-empty; infinite/drainable option.
- Buildings (barns, camps) and fleeing human NPCs.
- Rolling mission contracts, easy to hard.
- Three-act Earth story mode (find / repair / refuel the mothership) with stat screens.

**Worlds**
- Added Moon and Mars with unique fauna, terrain, weather and handling.
- Mars meteor showers; Moon low-gravity agility.

**Audio**
- Procedural per-world soundtracks; beam ignition/hum/shutdown; creature capture cries.

**Presentation & assets**
- Optional GLB models and image textures with procedural fallback.
- Splash/loading screen with per-asset progress; gated "Play" button.
- HUD refactor keeping the play area clear; in-world floating energy bar; radar minimap.
- Removed the bloom effect; single tuned graphics mode.

**Day / night & powers**
- Automatic day/night cycle changing lighting, speeds, and stealth.
- Real warm sunlight with lens flares by day; moonlit water reflection by night.
- Invisibility cloak (tap the saucer); tiered low-energy warnings.

**Performance & platform**
- Mobile tier: reduced spawns, lighter shadows, shorter draw distance, and fully procedural (no downloads) for speed — with an opt-in high-detail toggle.

---

Built with Three.js. No frameworks, no build step, one file.
