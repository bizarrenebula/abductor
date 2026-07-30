/* =========================================================================
   FLIGHT MODEL — ported from the "Many Lives" dragonfly prototype.

   Hover-capable, high-authority movement with real (analytic) inertia. Thrust
   is applied in the facing frame; velocity bleeds off through drag rather than
   requiring counter-thrust, so the craft can hover, strafe, reverse and stop.

   ISOLATION: the tuning profile is INJECTED (constructor arg) — this module
   imports no global config. Parameter names are identical to the source so
   tuning knowledge transfers. See flight-profile.js for this project's values.

   THREE is this project's global handle (r128), not the npm ESM package.
   ========================================================================= */
import { THREE } from '../core/three.js';

export class FlightModel {
  /**
   * @param {object} profile  the `flight` tuning block (see flight-profile.js)
   * @param {THREE.Vector3} [start]  initial base position (defaults to origin)
   */
  constructor(profile, start) {
    this.f = profile;
    this._start = start ? start.clone() : new THREE.Vector3(0, 0, 0);

    // _base is the integrated position; `position` is _base plus the hover
    // displacement, and is what the camera and mesh both read.
    this._base = this._start.clone();
    this.position = this._base.clone();
    this.velocity = new THREE.Vector3();
    this._hover = new THREE.Vector3();

    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.targetRoll = 0;

    this.quaternion = new THREE.Quaternion();
    this.speed = 0;
    this.speedNormalized = 0;

    this._time = 0;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._thrust = new THREE.Vector3();
    this._vInf = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  /**
   * @param {number} dt      delta time, seconds
   * @param {object} input   { forward, strafe, vertical, yawDelta, pitchDelta, boost }
   *                         forward/strafe/vertical are -1..1 thrust intents;
   *                         yawDelta/pitchDelta are per-frame heading increments
   *                         (already framerate-correct — the adapter multiplies a
   *                         held axis by dt, so summed heading is fps-independent).
   */
  update(dt, input) {
    const f = this.f;
    this._time += dt;

    // --- Orientation -------------------------------------------------------
    this.yaw -= input.yawDelta * f.turnRate;
    this.pitch -= input.pitchDelta * f.pitchRate;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -f.pitchLimit, f.pitchLimit);

    // Bank into the turn, and lean slightly with lateral strafe.
    //
    // ADAPTED for held (joystick/key) input rather than mouse: the source banked
    // on the per-frame mouse delta, which for a held axis is framerate-dependent.
    // Here roll follows the turn RATE (yawDelta/dt recovers the intent), so bank
    // is identical at every framerate. bankAmount is still the max roll angle.
    const yawRate = dt > 1e-6 ? (input.yawDelta / dt) / Math.max(1e-6, f.turnRate) : 0;
    this.targetRoll = (-yawRate - input.strafe * 0.4) * f.bankAmount;
    this.targetRoll = THREE.MathUtils.clamp(this.targetRoll, -f.bankAmount, f.bankAmount);
    this.roll += (this.targetRoll - this.roll) * Math.min(1, f.bankSpeed * dt);

    this._euler.set(this.pitch, this.yaw, this.roll);
    this.quaternion.setFromEuler(this._euler);

    // --- Thrust in the facing frame ---------------------------------------
    this._forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const maxSpeed = f.maxSpeed * (input.boost ? f.boostMultiplier : 1);
    const accel = f.acceleration * (input.boost ? f.boostMultiplier : 1);

    this._thrust.set(0, 0, 0);
    this._thrust.addScaledVector(this._forward, input.forward);
    this._thrust.addScaledVector(this._right, input.strafe);
    this._thrust.y += input.vertical * (f.verticalSpeed / Math.max(0.001, f.maxSpeed));

    if (this._thrust.lengthSq() > 1) this._thrust.normalize();

    // --- Integration -------------------------------------------------------
    // Analytic solution to  dv/dt = A - k·v  rather than stepped Euler.
    //
    // This matters more than it looks. Stepping thrust and drag separately is
    // frame-rate dependent — the same input produced ~9cm of divergence between
    // 30fps and 144fps over two seconds. Fatal here, because the whole point of
    // the port is a set of tuned constants that survive any framerate.
    //
    //   v(t) = v∞ + (v₀ − v∞)·e^(−k·t),  where v∞ = A/k
    //   Δx   = v∞·t + (v₀ − v∞)·(1 − e^(−k·t))/k
    //
    // Both are exact for any dt, so behaviour is identical at every framerate.
    const k = Math.max(0.0001, f.drag);
    const decay = Math.exp(-k * dt);

    this._vInf.copy(this._thrust).multiplyScalar(accel / k);
    this._delta.copy(this.velocity).sub(this._vInf);

    // Δx from the exact integral, computed before velocity is overwritten.
    this._step
      .copy(this._vInf).multiplyScalar(dt)
      .addScaledVector(this._delta, (1 - decay) / k);

    this.velocity.copy(this._vInf).addScaledVector(this._delta, decay);

    if (this.velocity.length() > maxSpeed) {
      this.velocity.setLength(maxSpeed);
      // Keep the step consistent with the clamped velocity.
      if (this._step.length() > maxSpeed * dt) {
        this._step.setLength(maxSpeed * dt);
      }
    }

    this._base.add(this._step);

    // Soft floor so the proxy cannot sink through a ground plane. floorY defaults
    // to 0; a terrain game can lower it or drive collision externally.
    const floorY = f.floorY != null ? f.floorY : 0;
    if (this._base.y < floorY) {
      this._base.y = floorY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // --- Hover micro-movement ---------------------------------------------
    // "The craft should never appear static." At low speed, layer in
    // non-repeating drift so hovering reads as alive rather than parked.
    //
    // This is a DISPLACEMENT applied on top of the integrated position, never
    // integrated into it. Adding an oscillation to position each frame would make
    // the amplitude depend on framerate and let error accumulate as drift.
    //
    // The stillness threshold is 10% of maxSpeed (source: 0.4 of 4.0 m/s), so it
    // is a ratio and stays correct at this project's scale automatically.
    const stillness = 1 - Math.min(1, this.velocity.length() / Math.max(0.001, 0.1 * f.maxSpeed));
    const t = this._time;
    this._hover.set(
      Math.sin(t * f.hoverDriftSpeed * 1.3) * f.hoverDriftAmount,
      Math.sin(t * f.hoverBobSpeed) * f.hoverBobAmount
        + Math.sin(t * f.hoverBobSpeed * 0.37) * f.hoverBobAmount * 0.4,
      Math.cos(t * f.hoverDriftSpeed) * f.hoverDriftAmount
    ).multiplyScalar(stillness);

    this.position.copy(this._base).add(this._hover);

    this.speed = this.velocity.length();
    this.speedNormalized = Math.min(1, this.speed / f.maxSpeed);
  }

  /** Restore to the start pose (or a supplied one). */
  reset(pos) {
    if (pos) this._start.copy(pos);
    this._base.copy(this._start);
    this.position.copy(this._base);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this._time = 0;
  }
}
