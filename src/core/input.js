/* =========================================================================
   INPUT — keyboard + pointer. Mutable pointer flags live on the shared `input`
   object so the main loop, the special, and the PULL button can all read/write
   them across modules. Tapping the ship toggles cloak.
   ========================================================================= */
import { THREE } from './three.js';
import { clamp } from './math.js';
import { camera, renderer } from './engine.js';
import { S } from './state.js';
import { saucer } from '../systems/saucer.js';
import { toggleCloak } from '../systems/cloak.js';

export const keys={};
export const input={dragActive:false,dragOX:0,dragOY:0,dragVX:0,dragVY:0,beamHold:false,lastTapT:-1e9,spHeld:false};

addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;
  if(k===' '||k.startsWith('arrow'))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});

const _ray=new THREE.Raycaster();const _ndc=new THREE.Vector2();
function tappedSaucer(e){
  _ndc.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  _ray.setFromCamera(_ndc,camera);
  const hits=_ray.intersectObject(saucer,true);
  return hits.length>0;
}
renderer.domElement.addEventListener('pointerdown',e=>{
  if(S.state==='playing'&&tappedSaucer(e)){ toggleCloak(); return; }   // tap the ship = cloak
  input.dragActive=true;input.dragOX=e.clientX;input.dragOY=e.clientY;input.dragVX=0;input.dragVY=0;
  const now=performance.now();
  if(now-input.lastTapT<320)input.beamHold=true;   // second tap of a double-tap: hold to beam
  input.lastTapT=now;
});
addEventListener('pointermove',e=>{if(input.dragActive){input.dragVX=clamp((e.clientX-input.dragOX)/70,-1,1);input.dragVY=clamp((e.clientY-input.dragOY)/70,-1,1);}});
addEventListener('pointerup',()=>{input.dragActive=false;input.dragVX=0;input.dragVY=0;input.beamHold=false;input.spHeld=false;});
addEventListener('pointercancel',()=>{input.dragActive=false;input.dragVX=0;input.dragVY=0;input.beamHold=false;input.spHeld=false;});
