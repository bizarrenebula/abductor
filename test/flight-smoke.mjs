/* =========================================================================
   Headless smoke test for the ported flight model + camera rig.

   Exercises the real modules (src/systems/flight.js, camera-rig.js) with no
   WebGL context, asserting the invariants the port exists to protect:
   framerate independence, no hover drift, camera never detaches, no per-frame
   allocation churn, and no NaN.

   The project loads THREE as a browser global (window.THREE); here we shim the
   handful of browser globals its core modules touch and point window.THREE at
   the npm `three` package, then dynamically import the modules.

   Run:  node --expose-gc test/flight-smoke.mjs      (from repo root)
   ========================================================================= */
import * as THREE from 'three';

// --- Browser-global shims so src/core/{three,env}.js load under node ---------
globalThis.window = globalThis;
globalThis.navigator = { userAgent: 'node', platform: 'node', maxTouchPoints: 0 };
globalThis.matchMedia = () => ({ matches: false });
globalThis.location = { search: '' };
globalThis.window.THREE = THREE;

// Dynamic import AFTER the shims are in place (static imports would run first).
const { FlightModel } = await import('../src/systems/flight.js');
const { CameraRig } = await import('../src/systems/camera-rig.js');
const { FLIGHT_PROFILE, L } = await import('../src/systems/flight-profile.js');
const { flightInputFrom, STICK_LOOK } = await import('../src/systems/flight-input.js');

const F = FLIGHT_PROFILE.flight;
const C = FLIGHT_PROFILE.camera;

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

console.log(`\nSaucer flight/camera port — smoke test   (L = ${L})\n`);

// --- Construction ----------------------------------------------------------
console.log('construction');
const camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, C.near, C.far);
const flight = new FlightModel(F, new THREE.Vector3(0, 20, 0));
const rig = new CameraRig(camera, C);
check('flight constructs finite', finite(flight.position));
check('profile injected (no global config)', flight.f === F && rig.c === C);

// --- Input adapter ---------------------------------------------------------
console.log('\ninput adapter');
{
  const dt = 1 / 60;
  // Mobile: left stick = look (yaw/pitch, rate×dt), right stick = move.
  const m = flightInputFrom({ tFwd: 1, tStrafe: -1, lookStickX: 1, lookStickY: -1 }, () => false, dt);
  check('move axes mapped (right stick)', m.forward === 1 && m.strafe === -1);
  check('look stick is rate×dt', Math.abs(m.yawDelta - STICK_LOOK * dt) < 1e-12
    && Math.abs(m.pitchDelta + STICK_LOOK * dt) < 1e-12);
  // PC: mouse deltas (consumed) + WASD move + Shift/Ctrl vertical.
  const inp = { mDX: 0.02, mDY: -0.01 };
  const held = (id) => id === 'forward' || id === 'ascend';
  const m2 = flightInputFrom(inp, held, dt);
  check('mouse look + keys mapped', Math.abs(m2.yawDelta - 0.02) < 1e-12 && m2.forward === 1 && m2.vertical === 1);
  check('mouse deltas consumed', inp.mDX === 0 && inp.mDY === 0);
}

// --- Simulation (randomised input) -----------------------------------------
console.log('\nsimulation (1800 frames @ 60fps, randomised input)');
const dt = 1 / 60;
let maxCamDist = 0, maxSpeed = 0, sane = true;
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 1800; i++) {
  const input = {
    forward: rand() > 0.35 ? 1 : rand() > 0.5 ? -1 : 0,
    strafe: rand() > 0.7 ? (rand() > 0.5 ? 1 : -1) : 0,
    vertical: rand() > 0.8 ? (rand() > 0.5 ? 1 : -1) : 0,
    yawDelta: (rand() - 0.5) * 0.05,
    pitchDelta: 0,
    boost: rand() > 0.9,
  };
  flight.update(dt, input);
  rig.update(dt, flight);
  maxCamDist = Math.max(maxCamDist, camera.position.distanceTo(flight.position));
  maxSpeed = Math.max(maxSpeed, flight.speed);
  if (!finite(flight.position) || !finite(camera.position)) { sane = false; break; }
}
check('positions stayed finite (no NaN)', sane);
check('rotations finite', [flight.yaw, flight.pitch, flight.roll].every(Number.isFinite));
check('speed respects max',
  maxSpeed <= F.maxSpeed * F.boostMultiplier + 0.01, `peak ${maxSpeed.toFixed(2)} u/s`);
check('never sank through the floor', flight.position.y >= (F.floorY ?? 0) - 1e-6,
  `y=${flight.position.y.toFixed(3)}`);

// Intimacy pillar as an assertion: the camera must never detach.
const leash = C.zoomMax + C.velocityLagMax + C.leashSlack;
check('camera stayed intimate (hard leash)', maxCamDist <= leash + 0.01,
  `peak ${maxCamDist.toFixed(2)}u vs leash ${leash.toFixed(2)}u`);

// --- Hover stability -------------------------------------------------------
console.log('\nhover stability (600 idle frames)');
flight.reset(new THREE.Vector3(0, 20, 0));
rig.reset();
const idle = { forward: 0, strafe: 0, vertical: 0, yawDelta: 0, pitchDelta: 0, boost: false };
const start = flight.position.clone();
let maxDrift = 0;
for (let i = 0; i < 600; i++) {
  flight.update(dt, idle);
  maxDrift = Math.max(maxDrift, flight.position.distanceTo(start));
}
const bound = F.hoverDriftAmount * 3 + F.hoverBobAmount * 3;
check('hover does not drift (displacement, not integration)', maxDrift < bound,
  `drift ${maxDrift.toFixed(4)}u, bound ${bound.toFixed(4)}u`);
check('hover still moves (never static)', maxDrift > 1e-3, `${maxDrift.toFixed(5)}u`);

// --- Framerate independence ------------------------------------------------
console.log('\nframerate independence (30fps vs 144fps, 2s of thrust)');
function run(step) {
  const f = new FlightModel(F, new THREE.Vector3(0, 20, 0));
  const cam = new THREE.PerspectiveCamera(C.fov, 1.6, C.near, C.far);
  const r = new CameraRig(cam, C);
  const held = { forward: 1, strafe: 0, vertical: 0, yawDelta: 0, pitchDelta: 0, boost: false };
  for (let t = 0; t < 2; t += step) { f.update(step, held); r.update(step, f); }
  return { pos: f.position.clone(), cam: cam.position.clone() };
}
const a = run(1 / 30), b = run(1 / 144);
const posDelta = a.pos.distanceTo(b.pos);
const camDelta = a.cam.distanceTo(b.cam);
// Residual divergence comes only from the maxSpeed clamp (non-analytic) and the
// spring's integer substep count — same sources the source tolerated at 0.05m.
// Scaled: tol = 0.05m × L ≈ 7u. The split-step bug this guards against was ~13u.
const frTol = 0.05 * L;
check('flight is framerate independent', posDelta < frTol, `${posDelta.toFixed(3)}u apart (tol ${frTol.toFixed(1)})`);
check('camera is framerate independent', camDelta < frTol, `${camDelta.toFixed(3)}u apart (tol ${frTol.toFixed(1)})`);

// --- Allocation churn ------------------------------------------------------
console.log('\nallocation churn (3000 frames)');
if (global.gc) global.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 3000; i++) { flight.update(dt, idle); rig.update(dt, flight); }
if (global.gc) global.gc();
const growth = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
check('no runaway allocation', growth < 8, `heap grew ${growth.toFixed(2)} MB${global.gc ? '' : ' (run with --expose-gc for a tight bound)'}`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
