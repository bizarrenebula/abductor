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
   VERTICAL: Shift ascend / Ctrl descend (PC), or the touch LIFT SLIDER — the
     thin strip down the seam between the two joystick halves (input.tClimb).
     It ADDS to whatever the facing frame is already doing rather than replacing
     it, which is the point: build speed on the right stick and then slide up,
     and the ship climbs along the vector it already has instead of stopping to
     change attitude first.

   Imports nothing from core/input.js; the caller passes `input` and `held`.
   ========================================================================= */

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const axis = (held, plus, minus) => (held(plus) ? 1 : 0) - (held(minus) ? 1 : 0);
export const STICK_LOOK = 1.2;   // full look-stick deflection → this × turnRate/pitchRate (rad/s)

/* ---- vertical feel -------------------------------------------------------
   The lift slider is a finger position; the ship is several tonnes of hovering
   disc. Feeding one straight into the other made altitude the one axis that
   responded instantly while every other control had inertia, and it read as a
   lift, not a craft.

   So the command is passed through a first-order lag with THREE different time
   constants, because the three cases genuinely differ:

     UP    — slowest. Climbing is work; the ship has to overcome its own mass
             before it goes anywhere, so a slide up builds rather than jumps.
     DOWN  — quickest. Dropping is mostly letting go, and a pilot ducking under
             something needs it to answer now.
     COAST — slowest of all, and it applies to RELEASE in either direction:
             the finger comes off and the ship carries on for a beat before it
             settles, which is the momentum you can feel in a heavy machine.

   Tuned by feel against the existing horizontal drag (0.3), which is what the
   rest of the craft moves like. */
const LIFT_TAU_UP = 0.55, LIFT_TAU_DOWN = 0.22, LIFT_TAU_COAST = 0.90;
let liftV = 0;
/* Called when a run starts or the ship respawns, so a climb held at the moment
   of a crash does not bleed into the next life. */
export function resetFlightInput(){ liftV = 0; }

/**
 * @param {object} input  core/input.js `input`
 * @param {(id:string)=>boolean} held  core/input.js `held`
 * @param {number} dt     seconds
 */
export function flightInputFrom(input, held, dt) {
  const forward  = clamp1((input.tFwd    || 0) + axis(held, 'forward', 'back'));
  const strafe   = clamp1((input.tStrafe || 0) + axis(held, 'strafeR', 'strafeL'));
  const verticalRaw = clamp1((input.tClimb || 0) + axis(held, 'ascend', 'descend'));
  const tau = verticalRaw === 0 ? LIFT_TAU_COAST
            : verticalRaw > liftV ? LIFT_TAU_UP : LIFT_TAU_DOWN;
  liftV += (verticalRaw - liftV) * (1 - Math.exp(-dt / tau));
  if (Math.abs(liftV) < 1e-4) liftV = 0;
  const vertical = liftV;

  // Look: mouse deltas are per-frame (consume them); stick + keys are rates (×dt).
  const yawStick = (input.lookStickX || 0) + axis(held, 'turnR', 'turnL');
  const yawDelta   = (input.mDX || 0) + yawStick * STICK_LOOK * dt;
  const pitchDelta = (input.mDY || 0) + (input.lookStickY || 0) * STICK_LOOK * dt;
  input.mDX = 0; input.mDY = 0;   // consumed

  return { forward, strafe, vertical, verticalRaw, yawDelta, pitchDelta, boost: false };
}

export default flightInputFrom;
