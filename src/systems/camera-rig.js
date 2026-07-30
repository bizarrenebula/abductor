/* =========================================================================
   CAMERA RIG — intimate spring-damper follow camera, ported from the
   "Many Lives" prototype. The player feels physically attached to the craft:
   a real second-order system gives the lag/overshoot/settle that reads as
   momentum, tuned in frequency + damping-ratio terms so values stay meaningful.

   ISOLATION: the tuning profile is INJECTED (constructor arg). Parameter names
   match the source. THREE is this project's global handle (r128).

   Invariants preserved verbatim (each was a real bug once): 240Hz substepped
   semi-implicit spring; body roll EXCLUDED from the basis then reintroduced as
   an explicit rollFollow (+ horizonLock); a HARD LEASH so the camera can lag but
   never detach; zero per-frame allocation.
   ========================================================================= */
import { THREE } from '../core/three.js';

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} profile  the `camera` tuning block (see flight-profile.js)
   */
  constructor(camera, profile) {
    this.camera = camera;
    this.c = profile;
    this.zoom = profile.distance;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.currentRoll = 0;

    // Hoisted scratch — nothing in the frame loop allocates.
    this._anchor = new THREE.Vector3();
    this._disp = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._flatQuat = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._initialised = false;
  }

  addZoom(delta) {
    const c = this.c;
    this.zoom = THREE.MathUtils.clamp(
      this.zoom + delta * c.zoomSpeed, c.zoomMin, c.zoomMax
    );
  }

  update(dt, flight) {
    const c = this.c;

    // Orientation basis. Body roll is deliberately excluded here — the craft
    // banks, the camera largely does not. This is the single most effective
    // motion-sickness mitigation available, and it is why roll is reintroduced
    // later as an explicit, tunable fraction.
    this._euler.set(flight.pitch, flight.yaw, 0);
    this._flatQuat.setFromEuler(this._euler);

    this._back.set(0, 0, 1).applyQuaternion(this._flatQuat);
    this._up.set(0, 1, 0).applyQuaternion(this._flatQuat);
    this._forward.set(0, 0, -1).applyQuaternion(this._flatQuat);

    // Anchor: behind and above the body, trailing further at speed so velocity
    // reads as momentum without costing the player any authority.
    const lag = Math.min(flight.speed * c.velocityLag, c.velocityLagMax);
    this._offset.set(0, 0, 0);
    this._offset.addScaledVector(this._back, this.zoom + lag);
    this._offset.addScaledVector(this._up, c.height);
    this._anchor.copy(flight.position).add(this._offset);

    if (!this._initialised) {
      this.position.copy(this._anchor);
      this.velocity.set(0, 0, 0);
      this.lookTarget.copy(flight.position);
      this._initialised = true;
    }

    // --- Spring-damper -----------------------------------------------------
    // stiffness is an angular frequency (rad/s); damping is the damping ratio.
    // ζ = 1 is critically damped; below 1 overshoots and feels floatier.
    //
    // Substepped at a fixed 240Hz. An explicit spring integrated at the display
    // rate gives measurably different motion at 30fps versus 144fps, which would
    // make every tuned camera value framerate-specific.
    const omega = c.positionStiffness;
    const zeta = c.positionDamping;
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;

    for (let i = 0; i < steps; i++) {
      this._disp.copy(this._anchor).sub(this.position);
      this._accel
        .copy(this._disp).multiplyScalar(omega * omega)
        .addScaledVector(this.velocity, -2 * zeta * omega);
      // Semi-implicit Euler: velocity first, then position from the new velocity.
      // Far more stable than fully explicit at these frequencies.
      this.velocity.addScaledVector(this._accel, h);
      this.position.addScaledVector(this.velocity, h);
    }

    // Hard leash: the camera may lag, but must never detach. Intimacy is the
    // pillar, so this clamp is a correctness constraint, not a nicety.
    const maxDist = this.zoom + c.velocityLagMax + c.leashSlack;
    this._disp.copy(this.position).sub(flight.position);
    if (this._disp.length() > maxDist) {
      this._disp.setLength(maxDist);
      this.position.copy(flight.position).add(this._disp);
    }

    this.camera.position.copy(this.position);

    // --- Aim ---------------------------------------------------------------
    // Smoothed look target, so rotation has its own inertia independent of
    // position. Aiming ahead of the body keeps the craft low-centre in frame.
    this._desiredLook
      .copy(flight.position)
      .addScaledVector(this._forward, c.lookAhead);
    // Drop the aim point below the ship so the view rests tilted downward — the
    // ground directly beneath the saucer (and the beam column) stays in frame.
    this._desiredLook.y -= c.lookDrop || 0;
    this.lookTarget.lerp(
      this._desiredLook,
      1 - Math.exp(-c.rotationStiffness * dt)
    );

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    // Partial roll follow. Full roll is nauseating; zero roll feels sterile.
    const targetRoll = c.horizonLock ? 0 : flight.roll * c.rollFollow;
    this.currentRoll += (targetRoll - this.currentRoll) * (1 - Math.exp(-6 * dt));
    this.camera.rotateZ(this.currentRoll);

    // Speed FOV kick. Sells velocity, but is a known sickness trigger — kept as a
    // toggle so it can be evaluated honestly rather than assumed good.
    const targetFov = c.enableFovKick
      ? c.fov + flight.speedNormalized * c.fovSpeedKick
      : c.fov;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-3 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  reset() {
    this._initialised = false;
    this.velocity.set(0, 0, 0);
    this.currentRoll = 0;
  }
}
