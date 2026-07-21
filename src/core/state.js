/* =========================================================================
   GAME STATE — the single shared `S` object every system reads and mutates.
   Kept as one object so its fields are live across module boundaries.
   ========================================================================= */
import { THREE } from './three.js';

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
  vel:new THREE.Vector3(),
  tiltX:0,tiltZ:0,
};

export const camOffset=new THREE.Vector3(0,27,35);
