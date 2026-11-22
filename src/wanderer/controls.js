/* =========================================================================
   WANDERER CONTROLS — on foot, first person.

   TOUCH
     · left ~45% of the screen: a dynamic joystick (walk; full deflection runs)
     · anywhere else: drag to look around
     · FIRE button (bottom right): the pulse gun — hold for repeat fire
     · HIDE button: appears beside a barn or house; tap to go in / come out

   DESKTOP
     · WASD walk, Shift sprint, mouse-look (pointer lock, from core/input.js),
       left click fires, E hides / leaves a shelter

   Like core/input.js this only produces intents on `W_IN`; the player
   controller integrates them. core/input.js stands its own touch scheme down
   while S.wanderer is set, and its pointer-lock mouse-look and left button are
   reused as-is (input.mDX/mDY and input.beamHold, which means "fire" here).
   ========================================================================= */
import { renderer } from '../core/engine.js';
import { TOUCH_ONLY } from '../core/env.js';
import { S } from '../core/state.js';
import { keys, input, held } from '../core/input.js';

export const W_IN={
  mx:0, my:0,          // move axes: x = strafe right, y = forward (-1..1)
  run:false,           // sprint
  lookDX:0, lookDY:0,  // accumulated look (radians), consumed by the controller
  fire:false,          // fire held
  hidePress:false,     // one-shot: enter / leave a shelter
};

const JOY_R=62;              // px for full deflection
const TOUCH_LOOK=0.0055;     // radians per pixel of drag

let joyPtr=null, joyOX=0, joyOY=0;
let lookPtr=null, lookX=0, lookY=0;
let tmx=0, tmy=0;            // touch stick values

const joyEl=()=>document.getElementById('joyL');
function showJoy(x,y){ const el=joyEl(); if(!el)return; el.style.left=x+'px'; el.style.top=y+'px'; el.classList.add('on'); knob(0,0); }
function knob(dx,dy){ const el=joyEl(); const k=el&&el.querySelector('.joy-knob'); if(k)k.style.transform='translate('+dx+'px,'+dy+'px)'; }
function hideJoy(){ const el=joyEl(); if(el)el.classList.remove('on'); }

const live=()=>S.wanderer&&S.state==='playing';

renderer.domElement.addEventListener('pointerdown',e=>{
  if(!live()||e.pointerType==='mouse')return;
  if(joyPtr===null&&e.clientX<innerWidth*0.45){
    joyPtr=e.pointerId; joyOX=e.clientX; joyOY=e.clientY; tmx=tmy=0;
    showJoy(joyOX,joyOY);
  }else if(lookPtr===null){
    lookPtr=e.pointerId; lookX=e.clientX; lookY=e.clientY;
  }
});
addEventListener('pointermove',e=>{
  if(e.pointerId===joyPtr){
    const dx=e.clientX-joyOX, dy=e.clientY-joyOY;
    const len=Math.hypot(dx,dy)||1, cl=Math.min(len,JOY_R);
    const kx=dx/len*cl, ky=dy/len*cl;
    knob(kx,ky);
    tmx=kx/JOY_R; tmy=-ky/JOY_R;
  }else if(e.pointerId===lookPtr){
    W_IN.lookDX+=(e.clientX-lookX)*TOUCH_LOOK;
    W_IN.lookDY+=(e.clientY-lookY)*TOUCH_LOOK;
    lookX=e.clientX; lookY=e.clientY;
  }
},{passive:true});
function endPtr(e){
  if(e.pointerId===joyPtr){ joyPtr=null; tmx=tmy=0; hideJoy(); }
  if(e.pointerId===lookPtr){ lookPtr=null; }
}
addEventListener('pointerup',endPtr);
addEventListener('pointercancel',endPtr);

/* ---- on-screen buttons (built by hud.js, wired here) ---- */
let firePtr=null, touchFire=false;
export function wireButtons(fireBtn,hideBtn){
  fireBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); firePtr=e.pointerId; touchFire=true; });
  const up=e=>{ if(e.pointerId===firePtr){ firePtr=null; touchFire=false; } };
  addEventListener('pointerup',up); addEventListener('pointercancel',up);
  fireBtn.addEventListener('contextmenu',e=>e.preventDefault());
  hideBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); W_IN.hidePress=true; });
}

/* E is read as an edge, not a level: one press = one toggle. */
let eWas=false;

/* Fold keyboard + touch into W_IN once per frame. */
export function pollControls(){
  let mx=tmx, my=tmy;
  if(!TOUCH_ONLY){
    const kx=(held('strafeR')?1:0)-(held('strafeL')?1:0);
    const ky=(held('forward')?1:0)-(held('back')?1:0);
    if(kx||ky){ mx=kx; my=ky; }
    // core/input.js accumulates pointer-lock mouse movement here
    W_IN.lookDX+=input.mDX; W_IN.lookDY+=input.mDY; input.mDX=0; input.mDY=0;
  }
  const l=Math.hypot(mx,my); if(l>1){ mx/=l; my/=l; }
  W_IN.mx=mx; W_IN.my=my;
  // Touch: a stick pushed nearly to its rim runs. Keyboard: Shift.
  W_IN.run=!!keys['shift']||(joyPtr!==null&&Math.hypot(tmx,tmy)>0.92);
  W_IN.fire=touchFire||(!TOUCH_ONLY&&input.beamHold);
  const e=!!keys['e'];
  if(e&&!eWas)W_IN.hidePress=true;
  eWas=e;
}

export function resetControls(){
  joyPtr=lookPtr=firePtr=null; tmx=tmy=0; touchFire=false; hideJoy();
  W_IN.mx=W_IN.my=W_IN.lookDX=W_IN.lookDY=0; W_IN.fire=W_IN.run=W_IN.hidePress=false;
  input.mDX=input.mDY=0; input.beamHold=false;
}
