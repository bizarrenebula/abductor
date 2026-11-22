# Wanderer mode

Design spec, agreed in Q&A, not yet built. A new game mode that sits alongside
Story and Exploration. The player is on the ground and defends the land against
AI saucers instead of piloting one.

## Premise

You are a wanderer on foot, crossing Earth to an escape point about 5 km away.
AI-controlled saucers roam the land abducting animals and villagers, and they
will take you too. A pulse gun drives them off for a while. Survive the trek,
don't get abducted, and push the saucers back along the way.

## Scope

- **New mode** on the setup screen. The saucer-pilot game is unchanged.
- **Earth only** for the first version. Moon and Mars come later.
- Existing world, NPCs, animals, settlements, roads, day/night, weather and
  hazards are all reused.

## Player

- **First-person** camera at eye height.
- **Touch:** an on-screen joystick (left) to walk, and dragging anywhere else to
  look. A fire button shoots the pulse. The minimap moves to the top right so
  it's clear of the joystick.
- **Desktop:** WASD to walk, Shift to sprint, mouse-look (pointer lock),
  left-click to fire, E to enter or leave a barn.
- The wanderer is grounded and follows the terrain. Water is impassable, or
  slows you down a lot.

### Hiding

- **Under trees** and **under bridges:** saucers can't see you while you're
  in cover, and an active beam can't lock you there.
- **In barns** and other shelters (the `shelters` registry): full cover. Heat
  cools fastest here.
- While in cover, the pulse gun can still fire, but firing reveals your
  position.

## The hand (no gun)

The pulse comes from the wanderer's own palm. The hand in the lower right of
the view speaks in mudras, so its shape always shows the state of the pulse:

| state | mudra |
|---|---|
| ready | relaxed hand, faint palm glow |
| firing | **Abhaya**: open palm thrust forward ("fear not") |
| recharging | **Gyan**: thumb to index finger |
| cell empty | fist |
| crystal taken | **Prana**: ring and little finger to the thumb (brief) |
| beamed by a saucer | fingers splayed and trembling |
| inside a shelter | hand lowered |

Poses blend smoothly into each other.

## Pulse

- Each shot costs **energy**. Crystals on the ground refill it when you walk
  over them. A very slow trickle recharge keeps an empty cell from leaving you
  with nothing at all.
- A hit **stuns** the saucer. It wobbles, drops whatever it was beaming and
  **retreats for about 15–20 s** before it comes back. Saucers can't be
  destroyed.

## AI saucers

- Several saucers roam at once, built on the existing saucer model, beam and
  abduction systems.
- They pick targets (animals, villagers, the wanderer) and beam them with the
  same lock-timer mechanic the player saucer uses.
- **Being beamed:** a lock ring fills while you're in the beam, shown in
  first-person as a screen-edge glow plus a lift and wobble. Breaking the lock
  takes leaving the beam, reaching cover or pulsing the saucer. A full lock
  means you're abducted.

## Escalation: awareness heat

This adapts `docs/awareness.md` to the new viewpoint.

- **Heat goes up** when you shoot saucers, when a saucer sees you in the open,
  and when you break their abductions.
- More heat means **more saucers**, and they switch from harvesting animals to
  **hunting you**. Higher stages add searchlights that sweep.
- **Heat goes down** over time, faster in cover (barns fastest) and at night
  when you're out of beams.

**Built** (`src/wanderer/heat.js`):

| stage | heat | saucers | what changes |
|---|---|---|---|
| QUIET | 0–25% | 3 | mostly harvesting; ~30% chance a free saucer comes for you |
| NOTICED | 25–50% | 5 | more of them pick you, and see you further off |
| HUNTED | 50–78% | 7 | searchlights sweep the ground and find you under trees (not under bridges or indoors) |
| SWARM | 78%+ | 8 | faster; a stunned saucer comes back after 9–13 s instead of 15–20 |

Heat rises with each repel (more if you broke an abduction), for every saucer
that sees you in the open, while you're in a beam, and when a searchlight
catches you. It falls over time: about 2.6× faster in tree or bridge cover,
5.5× faster inside a shelter, and faster at night when no beam is near. A
respawn halves it. Stages drop with a little hysteresis so they don't flicker.

## The trek

- The escape destination sits at the end of the **lane**
  (`world/lane.js`), about 5 km out and marked on the minimap.
- **Built:** the route follows the lane for about 5 km (5.0–5.7 km depending
  on the seed). The escape point is a concrete bunker with a radio mast and an
  amber beacon; reaching its door wins. Four save points sit evenly along the
  route, each with a tall green beacon, a minimap marker and a screen arrow.
  A save point is the space under a bridge when a road crosses within 150 m of
  that stretch, otherwise a waystation barn built on level ground. Their ground
  is reserved before the world is generated, so scenery never grows into them.
  Saving refills the pulse cell.
- **Save points** are spaced along the lane. Each one is a hiding place: a barn,
  an enterable building, or the space under a bridge. They're marked on the
  minimap and get a distinct glow so you can tell them from ordinary cover.
  Reaching one saves progress. Abduction offers one "run it back" from the last
  save point. A second abduction ends the run.
- Reaching the destination wins the run.

## Scoring and progression

- **Points come from repelling saucers.** Every successful pulse hit that drives
  a saucer off scores, whether it was beaming an animal, a villager or you.
- **Missions** are optional, rewritten for defence (for example, "repel 5
  saucers" or "reach the next checkpoint before dusk"). They pay points.
- **Points are spent on upgrades only at save points.** While you're inside one
  (fully hidden), a shop opens. Upgrades for the wanderer and the gun include a
  wider pulse, faster recharge, a larger energy cell and a sprint boost. Field
  parts on the map can also grant upgrades.

**Built** (`src/wanderer/shop.js`): the shop opens by itself when you're
properly inside a save point and closes when you walk out; SHOP / B reopens
it. Spending draws on a wallet (points earned minus spent), so it never lowers
the final score. Upgrades last the whole run, through a respawn:

| upgrade | levels (pts) | per level |
|---|---|---|
| Wide Pulse | 30 / 50 / 80 | hit radius +2.2, bigger pulse |
| Quick Hands | 30 / 50 / 80 | recharge ×0.78 |
| Deep Cell | 40 / 70 | energy per shot ×0.75 |
| Long Legs | 30 / 60 | run speed +1.3 |
| Firm Footing | 40 / 80 | a beam locks onto you ×0.78 as fast |
| Second Wind | 120 | one more run-it-back |

## Kept systems

- **Day/night:** at night beams are easier to spot from far off, and cover is
  more effective.
- **Weather:** limits how far you can see. It also limits how far saucers can
  see.
- **Hazards:** lightning and geysers can stagger or hurt the wanderer.

## Not in v1

- Moon and Mars.
- Destroying saucers.
- Points for the creatures themselves (only repels score).
