/* =========================================================================
   INPUT — keyboard + pointer. Mutable pointer flags live on the shared `input`
   object so the main loop, the special, and the PULL button can all read/write
   them across modules.

   Pointer gestures on the ship itself are separate from the drag-to-fly
   gesture used everywhere else on the canvas:
     · press and hold 2s on the ship  -> toggle cloak
     · swipe up / down on the ship    -> raise / lower hover altitude
   Moving past SHIP_SLOP cancels the pending hold, so a swipe never also
   cloaks; conversely holding still never nudges altitude.
   ========================================================================= */
import { THREE } from './three.js';
import { clamp } from './math.js';
import { camera, renderer } from './engine.js';
import { S } from './state.js';
import { HOVER_MIN, HOVER_MAX, HOVER_SENS } from './constants.js';
import { saucer } from '../systems/saucer.js';
import { toggleCloak } from '../systems/cloak.js';

export const keys={};
export const input={dragActive:false,dragOX:0,dragOY:0,dragVX:0,dragVY:0,beamHold:false,lastTapT:-1e9,spHeld:false,
  shipHold:false,       // finger is down on the ship
  shipSwiping:false,    // that press has become an up/down altitude swipe
  cloakProg:0};         // 0..1 progress of the hold-to-cloak timer, for the HUD ring

export const CLOAK_HOLD_MS=2000;   // press-and-hold duration that toggles cloak
export const CLOAK_KEY='c';        // desktop cloak toggle (q is taken by PULL)
const SHIP_SLOP=10;                // px of travel that turns a hold into a swipe

addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;
  // C toggles cloak — the keyboard equivalent of holding the ship for 2s.
  // Not Q: that already fires the special PULL (see Special.update in main.js).
  // e.repeat guards against key auto-repeat toggling it many times per second.
  if(k===CLOAK_KEY&&!e.repeat&&S.state==='playing')toggleCloak();
  if(k===' '||k.startsWith('arrow'))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});

const _ray=new THREE.Raycaster();const _ndc=new THREE.Vector2();
function tappedSaucer(e){
  _ndc.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  _ray.setFromCamera(_ndc,camera);
  const hits=_ray.intersectObject(saucer,true);
  return hits.length>0;
}
/* --- ship gestures: hold to cloak, swipe to change altitude --- */
let shipStartY=0, shipStartHover=0, holdT0=0, holdTimer=0, cloakFired=false;

function endShipGesture(){
  if(holdTimer){clearTimeout(holdTimer);holdTimer=0;}
  input.shipHold=false;input.shipSwiping=false;input.cloakProg=0;cloakFired=false;
}
function cancelHold(){                 // swipe started: the cloak timer is off
  if(holdTimer){clearTimeout(holdTimer);holdTimer=0;}
  input.cloakProg=0;
}

renderer.domElement.addEventListener('pointerdown',e=>{
  if(S.state==='playing'&&tappedSaucer(e)){
    input.shipHold=true;input.shipSwiping=false;cloakFired=false;
    shipStartY=e.clientY;shipStartHover=S.hover;
    holdT0=performance.now();
    // Once the cloak fires, the gesture is spent: don't let the same still-held
    // finger then start scrubbing altitude on its way back up.
    holdTimer=setTimeout(()=>{holdTimer=0;input.cloakProg=0;cloakFired=true;toggleCloak();},CLOAK_HOLD_MS);
    return;                            // never also starts a drag-to-fly
  }
  input.dragActive=true;input.dragOX=e.clientX;input.dragOY=e.clientY;input.dragVX=0;input.dragVY=0;
  const now=performance.now();
  if(now-input.lastTapT<320)input.beamHold=true;   // second tap of a double-tap: hold to beam
  input.lastTapT=now;
});

addEventListener('pointermove',e=>{
  if(input.shipHold){
    if(cloakFired)return;                       // gesture already spent on the cloak
    const dy=shipStartY-e.clientY;              // up on screen = positive = climb
    if(!input.shipSwiping&&Math.abs(dy)>SHIP_SLOP){input.shipSwiping=true;cancelHold();}
    if(input.shipSwiping){
      // Set the commanded altitude directly from total swipe distance; the main
      // loop lerps the ship toward it, which is what makes the climb gradual.
      S.hover=clamp(shipStartHover+dy*HOVER_SENS,HOVER_MIN,HOVER_MAX);
    }
    return;
  }
  if(input.dragActive){input.dragVX=clamp((e.clientX-input.dragOX)/70,-1,1);input.dragVY=clamp((e.clientY-input.dragOY)/70,-1,1);}
});

addEventListener('pointerup',()=>{endShipGesture();input.dragActive=false;input.dragVX=0;input.dragVY=0;input.beamHold=false;input.spHeld=false;});
addEventListener('pointercancel',()=>{endShipGesture();input.dragActive=false;input.dragVX=0;input.dragVY=0;input.beamHold=false;input.spHeld=false;});

/* Drive the hold-to-cloak progress value the HUD reads. Cheap enough to poll. */
setInterval(()=>{
  input.cloakProg=(input.shipHold&&holdTimer)?Math.min(1,(performance.now()-holdT0)/CLOAK_HOLD_MS):0;
},33);
