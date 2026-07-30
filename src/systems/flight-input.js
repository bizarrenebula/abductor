/* =========================================================================
   FLIGHT INPUT ADAPTER — maps THIS project's controls into the generic input
   shape FlightModel expects. Keeps flight.js / camera-rig.js free of any
   project-specific input knowledge (the glue lives here).

   The source model was mouse-look (pointer lock): yawDelta/pitchDelta were raw
   mouse deltas. This project is twin-joystick + keyboard with no pointer lock,
   so heading is driven by a held turn axis. To stay framerate-correct the turn
   intent is multiplied by dt here, giving a per-frame heading increment whose
   sum over time is independent of framerate.

   Pass in the project's live `input` object and its `held(id)` predicate
   (both from core/input.js); this module imports neither, so it stays testable
   and decoupled.
   ========================================================================= */

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const axis = (held, plus, minus) => (held(plus) ? 1 : 0) - (held(minus) ? 1 : 0);

/**
 * @param {object} input  core/input.js `input` (tFwd,tStrafe,tTurn,tClimb, …)
 * @param {(id:string)=>boolean} held  core/input.js `held`
 * @param {number} dt     seconds
 * @returns {{forward,strafe,vertical,yawDelta,pitchDelta,boost}}
 */
export function flightInputFrom(input, held, dt) {
  const forward  = clamp1((input.tFwd    || 0) + axis(held, 'forward', 'back'));
  const strafe   = clamp1((input.tStrafe || 0) + axis(held, 'strafeR', 'strafeL'));
  const vertical = clamp1((input.tClimb  || 0) + axis(held, 'ascend',  'descend'));

  // Turn intent (−1..1), right positive → decreases yaw (this project's turn-right
  // convention). Multiply by dt so the summed heading is framerate-independent.
  const turn = clamp1((input.tTurn || 0) + axis(held, 'turnR', 'turnL'));

  return {
    forward,
    strafe,
    vertical,
    yawDelta: turn * dt,
    pitchDelta: 0,      // a hovering saucer holds level — no pitch look (craft).
    boost: false,       // no boost control mapped yet; wire a key here if wanted.
  };
}

export default flightInputFrom;
