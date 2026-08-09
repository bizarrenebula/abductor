# Awareness: giving the game a direction

Design note — not yet built. Written after a session where the verdict was
"play ready, but it lacks challenge". This says what is actually missing, what
to build instead of tuning numbers, and in what order.

The short version: **the world does not respond to the player.** Everything
else in this note follows from that one sentence.

---

## 1. What we have, and why it is not enough

The foundation is genuinely good and it is worth being precise about what it is,
because the direction below is chosen to use it rather than to sit beside it.

- **A flight model worth flying.** Hover-capable, analytic inertia, banking that
  reads. Climb, dive, strafe, the lift filter's coast.
- **A world that streams and holds together.** Three regions, deterministic
  placement, settlements, roads, a lane that guarantees a run crosses all three.
- **Systems that already know how to hurt you.** Meteors, geysers, lightning and
  collision all flip `S.state` to `'crashing'` through a path that works.
- **People who react.** Sight radius, flee-to-shelter, hide-inside.

And yet a run is flat. The reason is not difficulty tuning.

**Every hazard in the game is weather.** Meteors, geysers, lightning, terrain —
they happen *near* the player, never *because of* the player. Abduct forty
villagers and the fortieth is exactly as dangerous as the first. No escalation
means no tension curve, which means a run has no shape however long it lasts.

Three things fall out of that, and all three read as separate complaints:

### 1.1 The cloak has nothing to hide from

NPCs notice the ship at 52m and run for a door. That is an inconvenience, not a
threat. The most interesting module in the game is currently a convenience for
catching things that would otherwise jog away.

### 1.2 The upgrades are terminal

Three modules. Collect them, and the ship is finished. Nothing pulls the player
forward after the first twenty minutes, because there is nothing left the world
can ask for.

### 1.3 The energy economy has an opt-out

This one is a live defect, introduced deliberately and with a hole in it.

Energy powers exactly two things: the cloak and the mass pull. That was the
right call — flying and the ordinary beam must stay free, or a flat reactor
strands the player with no way to refuel. But it means **a player who never
cloaks never needs a single crystal.** The whole resource loop is optional.

Tuning drain rates will not fix this. The loop needs a reason to be entered.

---

## 2. The direction: the world learns about you

One system, and it repairs all three of the above without adding a currency, a
panel, or a new verb.

**Abductions raise awareness. Awareness escalates the world's response.
Awareness decays when the player is quiet. The cloak is the pressure valve, and
the cloak costs energy.**

That last clause is the whole economic fix: making the cloak *necessary* is what
makes crystals matter. The loop closes itself with no new parts.

### 2.1 The state

Two numbers, not one.

| | scope | what it drives | decay |
|---|---|---|---|
| **local heat** | per settlement | which stage that town is at | fast — minutes |
| **network level** | per run, global | the ceiling local heat can reach | slow, or never |

Local heat is what makes "leave and come back later" a real move. The network
level is what stops a long run from resetting to easy every time the player
crosses a region, and it is the number a run's difficulty curve actually rides
on.

**Accrual**, roughly in order of how loud each act is:

- taking a person, in sight of another person — the big one
- being seen at all, uncloaked, by anyone
- an open beam at night (it is a light in the dark; it should carry further than
  the hull does)
- the mass pull — dramatic, and it should cost more than it currently does in
  anything but energy

**Decay** on time, and faster while unseen. Being *inside* a settlement should
hold heat up even if nothing is happening: the town knows you are here.

### 2.2 The stages

Four, because each has to change the player's behaviour in a different way. A
stage that only makes numbers worse is not a stage.

| stage | the world does | the player must |
|---|---|---|
| **0 · quiet** | as now | nothing — this is the baseline |
| **1 · noticed** | lights come on, streets empty, people stay inside | accept fewer targets, or move on |
| **2 · armed** | villagers fetch guns and shoot at the hull | keep moving, use height, or go dark |
| **3 · hunted** | airborne response, searchlights that sweep | leave, or cloak and stay cloaked |

Stage 1 is *economic* pressure — the harvest dries up. Stage 2 is *survival*
pressure. Stage 3 is *movement* pressure: it cannot be fought, only escaped or
hidden from. Escalating through three different kinds of pressure is what gives
a run a curve rather than a slope.

Stage 2 is the militia idea from an earlier session, and it lands here rather
than as a standalone feature because on its own it is a random hazard — the
thing this note exists to argue against. As a *consequence*, it is a story.

### 2.3 What this fixes

- **The flat run** — success now makes the world harder, which is the tension
  curve that is missing.
- **The cloak** — it becomes the answer to stages 2 and 3 rather than a nicety.
- **The crystal loop** — the cloak is needed, so energy is spent, so crystals
  matter. No new system.
- **The regions and the lane** — heat is local, so moving on is how you cool
  down. The world's geography becomes a mechanic instead of scenery.
- **The terminal upgrades** — there is now a difficulty ceiling that a better
  ship is measured against, which is what a progression needs to exist at all.

---

## 3. What it needs from what already exists

Almost all of it is here. This is a wiring job more than a building job.

| need | already have |
|---|---|
| who lives where | `world/settlements.js` hash grid, `shelters` in the registry |
| people who react | `updateHuman` sight + flee-to-shelter |
| solid things to shoot from | `buildings` registry, collision |
| a damage → death path | meteors/geysers/lightning already flip to `'crashing'` |
| lights that can come on | `systems/nightlights.js` |
| a way to surface state briefly | `ModuleIcons` — the pattern, not the code |

### 3.1 The trap: heat must not live on the chunk

Settlements are pure functions of position and stream in and out with chunks.
**Heat must not be stored on the chunk or on the spawned objects**, because
flying 500m away unloads it — and a town forgetting the player the moment they
leave visual range is precisely the wrong behaviour. It would make the correct
strategy "back off 500m and return", which is a shorter and more boring loop
than the one we are trying to create.

Heat belongs in its own map keyed by settlement cell (`s.cx,s.cz`), with a
lifetime independent of chunk residency. This is the same class of bug as the
chunk-local `placed[]` array in `object-placement.md` — the identical mistake,
one system over.

**Regression test: heat must survive a chunk unload/reload round trip.** Write
that one first.

---

## 4. How it gets verified

The measurement harness comes before the tuning, same as always. Every
placement bug this project has had was found by measuring and none by looking.

- **time to each stage**, at a standard harvest rate — the answer to "how long
  before anything happens" must be seconds-to-minutes, not tens of minutes
- **decay half-life**, measured, per stage
- **stage reached per run**, across many simulated runs — if most runs never see
  stage 2, the accrual is too slow and the whole system is decoration
- **survivability of stage 3 without a cloak** — the target is "barely, by
  leaving immediately". If it is comfortable, stage 3 is not doing its job; if
  it is impossible, the cloak stops being a choice and becomes a tax
- **crystals collected per run, before and after** — this is the direct test of
  whether the economic hole in §1.3 actually closed
- **heat after an unload/reload cycle** — must be unchanged (§3.1)

---

## 5. Build order

Independently shippable, independently verifiable. Do not attempt as one change.

1. **Awareness state.** Accrual, decay, local + network, the persistence map,
   and the harness. No visible response yet — the numbers are the deliverable
   and the unload/reload test is the gate.
2. **Stage 1.** Lights, empty streets, people indoors. Cheap, uses
   `nightlights.js` and the existing flee/hide behaviour, and it is the first
   time the world visibly answers back.
3. **Stage 2 — the militia.** NPC home association, arming, projectiles, hull
   damage. The big one; realistically a session on its own.
4. **Stage 3 — the hunt.** Airborne response and searchlights.
5. **Run scoring.** Clean vs hot, and what the player takes home from each.
6. **Then tune**, with the numbers visible.

Steps 1–2 are roughly a session. Step 3 is a session. Steps 4–5 are a session.
Step 6 is open-ended and is the fun part.

---

## 6. Open decisions

- **Should being caught kill you?** Leaning no. A crash ends a run abruptly and
  teaches nothing; being *driven off* — forced out of the region with a reduced
  take — is a better lesson and a better story. But it needs a real failure
  state or stage 3 is theatre.
- **Does the desert have heat at all?** It has no people, so structurally it
  cannot. That inverts the current difficulty claim: today the desert is the
  hardest region because vultures are hard to catch; with awareness in the world
  it becomes the *safe* region, and the settled country becomes the dangerous
  one. That is arguably better — it gives the desert a purpose beyond being
  sparse, as the place you run to and cool off. It also means the tutorial's
  "wilderness easy, towns harder, desert hardest" line becomes untrue and has to
  be rewritten. Decide before step 1, because it changes what the network level
  is even measuring.
- **Does the network level persist between runs?** Exploration probably not.
  Story mode probably yes — it is a progression.
- **Is heat visible, and how?** A number is honest and ugly. The alternative is
  to let the world say it — lights, silence, the sound of a door. Leaning on
  diegetic signals with no HUD element at all, but that risks the player not
  understanding why they died.

---

## 7. The Pi overlay (optional, and deliberately separable)

There is a live question about shipping this on Pi Network's app platform. The
mechanic above is designed so that decision changes nothing structural.

Pi's own history is an awareness curve — an unwatched beta, then a walled
network, then an open and defended one. That is the same shape as §2.2, which
means the themed version is a re-skin of a working system rather than new
engineering:

- **the enclosed network** → a region you can see and cannot enter until it
  opens. `RESTRICT_R` and the Area 51 zone already do exactly this.
- **nodes** → a ground structure you hold the beam on for several seconds to
  charge. Stationary, vulnerable, and therefore the perfect objective to pair
  with stage 2.
- **crystals → shards.** A rename. Do *not* add a third currency next to harvest
  points and crystals.
- **the daily tap** → a charged reactor on the first run of the day.

**Do not build a version that pays out real Pi.** App-to-user payments come from
the developer's own wallet, so every coin is a cost that scales with success;
and more importantly it selects for players optimising a payout rather than
players who want to fly a saucer at night. The sanctioned direction is the other
one — small user-to-app payments for cosmetics.

Build §2 first regardless. If Pi goes ahead, the theming is nearly free. If it
does not, the game's central problem is fixed anyway. That asymmetry is the
whole argument for this order.
