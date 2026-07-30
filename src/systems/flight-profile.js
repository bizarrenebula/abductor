/* =========================================================================
   FLIGHT / CAMERA TUNING PROFILE for the saucer.

   This is the project-owned profile INJECTED into FlightModel and CameraRig, so
   the shared modules never need editing to retune. Parameter names are identical
   to the source "Many Lives" dragonfly prototype so tuning knowledge transfers.

   ── SCALE ──────────────────────────────────────────────────────────────────
   Source was tuned for a 0.07 m dragonfly, 1 unit = 1 m. The saucer hull is
   SphereGeometry(5) → ~10-unit diameter. So the size ratio is:

        L = 10 / 0.07  ≈  143

   Each line below shows:  source value  → ×L (pure rescale)  → FINAL.
   • Lengths / velocities / accelerations are ×L (keeps body-lengths-per-second
     constant).
   • Rates, ratios and angles (1/s, dimensionless, rad) are carried over
     UNCHANGED — they are scale-invariant.
   • camera.velocityLag is SECONDS (m per m/s), a time constant — NOT scaled.
     The trailing distance it produces (speed × velocityLag) already scales with
     L because speed does; scaling velocityLag too would double-count.

   ── CRAFT ADAPTATION (TASK 4) ───────────────────────────────────────────────
   The source is an insect: 57 body-lengths/s, near-instant authority, big bank,
   full mouse-look pitch. A UFO is a heavy hovering disc in a crash-careful world.
   Where FINAL differs from the pure ×L rescale it is marked [craft]; the reason
   is in the trailing comment. Nothing is dropped — every parameter is still here
   and live, just retuned.
   ========================================================================= */

export const L = 143;   // saucer ~10u / dragonfly 0.07m

export const FLIGHT_PROFILE = {
  flight: {
    // maxSpeed 4.0 → 572 → 130 [craft]: 57 bl/s is insect-zippy; a heavy craft
    // in this crash-sensitive world cruises ~13 bl/s (still ~2× the old game).
    maxSpeed: 130,          // units/s
    // acceleration 14 → 2002 → 416 [craft]: v∞ = accel/drag = 416/3.2 = 130 =
    // maxSpeed, so cruise still reaches the cap — but 416 (vs 2002) builds speed
    // over ~0.3–0.6 s, so it reads as mass instead of a teleporting insect.
    acceleration: 416,      // units/s²
    drag: 3.2,              // 1/s   — unchanged (rate). Coast time τ = 1/k ≈ 0.31 s.
    // verticalSpeed 2.2 → 314.6 → 75 [craft]: responsive climb (the free-flight
    // game needs to gain height to clear obstacles) without the insect's 314 u/s.
    verticalSpeed: 75,      // units/s
    boostMultiplier: 2.5,   // unchanged (ratio)

    turnRate: 1.9,          // rad/s — 2.6 unchanged → 1.9 [craft]: full-stick yaw
                            //         ≈ 109°/s; a heavy disc turns deliberately.
    pitchRate: 1.6,         // rad/s — 2.0 → 1.6 [craft]; unused while pitchDelta=0
                            //         (a hovering saucer holds level — see adapter).
    pitchLimit: 0.35,       // rad   — 1.1 → 0.35 [craft]: ~20°, a disc barely tips.

    bankAmount: 0.22,       // rad   — 0.55 → 0.22 [craft]: ~13° lean into a turn,
                            //         not the insect's 31°.
    bankSpeed: 4.0,         // 1/s   — unchanged (how quickly roll settles).

    // Hover character — "never appears static". Amplitudes are lengths → ×L.
    hoverBobAmount: 0.55,   // units — 0.004 → 0.572 → 0.55
    hoverBobSpeed: 2.4,     // unchanged
    hoverDriftAmount: 0.42, // units — 0.003 → 0.429 → 0.42
    hoverDriftSpeed: 0.7,   // unchanged

    floorY: 0,              // soft floor (added for reuse); a terrain game lowers
                            // this or drives ground collision externally.
  },

  camera: {
    // Distances are player-relative → ×L.
    distance: 31,           // units — 0.22 → 31.5 → 31  (~3 hull-widths back: intimate)
    height: 8,              // units — 0.055 → 7.9 → 8
    zoomMin: 20,            // units — 0.15 → 21.5 → 20
    zoomMax: 52,            // units — 0.40 → 57.2 → 52
    zoomSpeed: 5,           // units — 0.04 → 5.7 → 5

    positionStiffness: 6.5, // rad/s — 9.0 → 6.5 [craft]: LOWER natural frequency =
                            //         a floatier, weightier spring, fitting mass.
    positionDamping: 0.88,  // ζ — unchanged (slight overshoot keeps it alive).
    rotationStiffness: 5.5, // 1/s — 7.0 → 5.5 [craft]: aim catches up a touch slower.

    velocityLag: 0.035,     // SECONDS — unchanged. Trail = speed×0.035 auto-scales.
    velocityLagMax: 17,     // units — 0.12 → 17.2 → 17 (clamp; a safety leash).

    lookAhead: 9,           // units — 0.06 → 8.6 → 9
    leashSlack: 21,         // units — source hardcoded 0.15 → 21.5 → 21 (was inline).

    fov: 62,                // deg — 68 → 62 [craft]: matches the game's existing
                            //       camera; a UFO needs no compound-eye wide FOV.
    fovSpeedKick: 6,        // deg — 8 → 6 (scale-invariant; eased for comfort).

    // Motion-sickness controls — kept exposed, never hardcoded.
    rollFollow: 0.18,       // 0-1 — 0.25 → 0.18 [craft]: camera copies less bank.
    horizonLock: false,     // true = camera never rolls at all.
    enableFovKick: true,    // toggle the speed FOV kick.

    // near/far describe THIS world's frustum, not the player — so they are NOT
    // ×L (scaling the insect's far 300→42900 would be absurd). Kept at the game's
    // existing values. The rig doesn't set these; they live in engine.js. Here
    // for reference only.
    near: 0.5,
    far: 1400,
  },
};

export default FLIGHT_PROFILE;
