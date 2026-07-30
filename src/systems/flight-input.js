/* =========================================================================
   FLIGHT INPUT ADAPTER — maps THIS project's controls into the generic input
   shape FlightModel expects. Keeps flight.js / camera-rig.js free of any
   project-specific input knowledge.

   LOOK (yaw + pitch):
     PC     — pointer-lock mouse deltas (input.mDX/mDY, already ×sensitivity),
              consumed per frame.
     Mobile — left joystick (input.lookStickX/Y), rate-based (×dt).
     Keyboard ←/→ add optional yaw. Pitch feeds the facing-frame thrust, so
     "forward + look up" climbs and "back + look down" descends.
   MOVE (forward + strafe): right joystick (tFwd/tStrafe) or WSAD (held).
   VERTICAL: Shift ascend / Ctrl descend (PC). Mobile leaves this 0 — climb
     comes from pitch+forward.

   Imports nothing from core/input.js; the caller passes `input` and `held`.
   ========================================================================= */

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const axis = (held, plus, minus) => (held(plus) ? 1 : 0) - (held(minus) ? 1 : 0);
export const STICK_LOOK = 1.2;   // full look-stick deflection → this × turnRate/pitchRate (rad/s)

/**
 * @param {object} input  core/input.js `input`
 * @param {(id:string)=>boolean} held  core/input.js `held`
 * @param {number} dt     seconds
 */
export function flightInputFrom(input, held, dt) {
  const forward  = clamp1((input.tFwd    || 0) + axis(held, 'forward', 'back'));
  const strafe   = clamp1((input.tStrafe || 0) + axis(held, 'strafeR', 'strafeL'));
  const vertical = axis(held, 'ascend', 'descend');   // Shift / Ctrl (PC); 0 on mobile

  // Look: mouse deltas are per-frame (consume them); stick + keys are rates (×dt).
  const yawStick = (input.lookStickX || 0) + axis(held, 'turnR', 'turnL');
  const yawDelta   = (input.mDX || 0) + yawStick * STICK_LOOK * dt;
  const pitchDelta = (input.mDY || 0) + (input.lookStickY || 0) * STICK_LOOK * dt;
  input.mDX = 0; input.mDY = 0;   // consumed

  return { forward, strafe, vertical, yawDelta, pitchDelta, boost: false };
}

export default flightInputFrom;
