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
    // [heavy] A huge, ponderous ship, not a dragonfly. maxSpeed 120→90;
    // acceleration 220→130 and drag 1.9→1.4 (v∞=130/1.4≈93≈maxSpeed) so it builds
    // speed over ~1.5 s and coasts to rest over ~2 s — heavy mass, real momentum
    // and a clear delay between input and response, not twitch.
    maxSpeed: 90,           // units/s — [heavy] 120→90: lower top speed.
    acceleration: 130,      // units/s² — [heavy] 220→130: slow build-up (input lag).
    drag: 1.4,              // 1/s   — [heavy] 1.9→1.4: longer coast/glide
                            //         (τ = 1/k ≈ 0.71 s) = heavier, takes ~2 s to stop.
    verticalSpeed: 44,      // units/s — [heavy] 60→44: slower vertical.
    boostMultiplier: 2.0,   // [heavy] 2.5→2.0

    turnRate: 0.9,          // rad/s — [heavy] 1.3→0.9: a big disc yaws deliberately.
    pitchRate: 0.9,         // rad/s — [heavy] 1.1→0.9: slower, weightier nose authority
                            //         (mouse / left-stick Y drive pitch → climb/dive).
    pitchLimit: 0.6,        // rad   — ~34°: enough nose-up/down to climb or dive.

    bankAmount: 0.18,       // rad   — ~10° lean into a turn.
    bankSpeed: 2.0,         // 1/s   — [heavy] 2.6→2.0: roll eases in/out slowly/weighty.

    // Hover character — steadier for a large hull. Amplitudes are lengths (×L).
    hoverBobAmount: 0.35,   // units — [heavy] 0.55→0.35
    hoverBobSpeed: 2.4,     // unchanged
    hoverDriftAmount: 0.28, // units — [heavy] 0.42→0.28
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

    positionStiffness: 4.2, // rad/s — [heavy] 5.0→4.2: floatier, weightier spring.
    positionDamping: 0.9,   // ζ — slight overshoot keeps it alive.
    rotationStiffness: 3.8, // 1/s — [heavy] 4.5→3.8: aim catches up slower (mass).

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
