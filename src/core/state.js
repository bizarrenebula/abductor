/* =========================================================================
   GAME STATE — the single shared `S` object every system reads and mutates.
   Kept as one object so its fields are live across module boundaries.
   ========================================================================= */
import { THREE } from './three.js';
import { HOVER_BASE } from './constants.js';

export const S={
  state:'menu',            // menu | playing | over | paused | crashing | storyPause
  score:0,
  lockTime:2, beamR:8, timeLimit:180, endless:false,
  timeLeft:180,
  beamPower:0,
  taken:0, tally:{},
  world:'earth', energyMode:'drain', energy:1, vy:0,
  crystals:0, missionIdx:0, prevBeam:false, crashReason:null,
  isDay:true, dayF:1, storyMode:false,
  cloak:false, warnLevel:0, elapsed:0,
  gfx:'full',              // graphics quality: 'full' (cinematic) | 'basic' — set by screens.js
  musicMode:'soundtrack',  // music source: 'soundtrack' (bundled MP3) | 'procedural' synth
  // Ship upgrade perk (see systems/upgrades.js). The ship starts "grounded":
  // no altitude control, standard engines, basic beam, cloak locked. Collecting
  // raises upBeam/upSpeed multipliers and flips upAltitude/upCloak on.
  upBeam:1, upSpeed:1, upAltitude:false, upCloak:false,
  hover:HOVER_BASE,        // commanded height above terrain; swipe on the ship to change
  hoverV:0,                // climb/dive rate (world u/s) — integrated with momentum
  agl:HOVER_BASE,          // actual height above ground, recomputed each frame
  beamStr:1,               // beam strength multiplier from altitude (1 at HOVER_BASE)
  vel:new THREE.Vector3(),
  yaw:0, yawV:0,           // ship heading (rad) + its angular velocity; the flight frame turns with it
  tiltX:0,tiltZ:0,
  // rolling "last living point" for the story-mode respawn (see main.js)
  safePos:new THREE.Vector3(0,40,0), safeYaw:0, safeT:0,
};

/* Chase camera. camOffset is where the camera sits relative to the saucer;
   camLook is the point it aims at, also saucer-relative. Together they set the
   pitch: a low camOffset.y with a camLook.y at or above 0 flattens the view so
   the horizon reads, rather than staring down at the ground. */
export const camOffset=new THREE.Vector3(0,18,42);
export const camLook=new THREE.Vector3(0,1,0);
