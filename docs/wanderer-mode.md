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
  look. A fire button shoots the pulse.
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

## Pulse gun

- Each shot costs **energy**. Crystals on the ground refill it when you walk
  over them (or hold to collect them).
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

## The trek

- The escape destination sits at the end of the **lane**
  (`world/lane.js`), about 5 km out and marked on the minimap.
- **Checkpoints** are spaced along the lane. Reaching one saves progress.
  Abduction offers one "run it back" from the last checkpoint. A second
  abduction ends the run.
- Reaching the destination wins the run.

## Scoring and progression

- **Points come from repelling saucers.** Every successful pulse hit that drives
  a saucer off scores, whether it was beaming an animal, a villager or you.
- **Missions** are optional, rewritten for defence (for example, "repel 5
  saucers" or "reach the next checkpoint before dusk"). They pay points.
- **Points are spent on upgrades** for the wanderer and the gun, for example a
  wider pulse, faster recharge, a larger energy cell or a sprint boost. Field
  parts on the map can also grant upgrades.

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
