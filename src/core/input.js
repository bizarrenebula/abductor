/* =========================================================================
   INPUT — keyboard + two on-screen joysticks (touch), self-contained (no lib).

   DESKTOP
     · ↑ / ↓   move forward / backward (relative to heading)
     · ← / →   strafe left / right
     · A / D   rotate the ship left / right
     · W / S   ascend / descend
     · space   beam   ·   Q  pull   ·   C  cloak

   TOUCH — two dynamic joysticks, one per screen half:
     · RIGHT stick: y = forward/back, x = strafe   (fly the ship around)
     · LEFT  stick: x = rotate,       y = altitude (steer facing + height)
     · double-tap + hold the RIGHT stick opens the beam (fly while beaming)
     · press-and-hold the SAUCER itself for 2s to toggle cloak
     · the ZOOM slider (top-right) sets the camera distance
     · PULL button fires the special

   The module only produces intents on `input.*`; the main loop integrates them
   with momentum, so nothing here ever writes a position.
   ========================================================================= */
import { THREE } from './three.js';
import { camera, renderer } from './engine.js';
import { S } from './state.js';
import { saucer } from '../systems/saucer.js';
import { toggleCloak } from '../systems/cloak.js';

export const keys={};
export const input={
  tFwd:0, tStrafe:0, tTurn:0, tClimb:0,   // touch joystick axes, each -1..1
  beamHold:false, spHeld:false,
  zoom:1,                                  // camera-zoom multiplier, driven by the slider
  cloakProg:0,                             // 0..1 progress of the hold-the-ship-to-cloak timer
};

export const CLOAK_KEY='c';
export const CLOAK_HOLD_MS=2000;   // press-and-hold the saucer this long to toggle cloak
const R=68;                        // joystick radius (px) for full deflection
const SHIP_SLOP=12;                // px of travel that cancels a pending cloak hold

addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;
  if(k===CLOAK_KEY&&!e.repeat&&S.state==='playing')toggleCloak();
  if(k===' '||k.startsWith('arrow'))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});

/* ---- twin joysticks ---- */
const joyEl={L:null,R:null};
function joy(h){ if(joyEl[h]===null)joyEl[h]=document.getElementById(h==='L'?'joyL':'joyR'); return joyEl[h]; }
function showJoy(h,ox,oy){ const el=joy(h); if(!el)return; el.style.left=ox+'px';el.style.top=oy+'px';el.classList.add('on'); moveKnob(h,0,0); }
function moveKnob(h,dx,dy){ const el=joy(h); if(!el)return; const k=el.querySelector('.joy-knob'); if(k)k.style.transform='translate('+dx+'px,'+dy+'px)'; }
function hideJoy(h){ const el=joy(h); if(el)el.classList.remove('on'); }
function setBeaming(on){ const el=joy('R'); if(el)el.classList.toggle('beaming',on); }   // hides the "double-tap" hint while beaming

// RIGHT stick = move the ship in the plane (forward/back + strafe); LEFT stick =
// rotate the nose + altitude. So the right thumb flies the saucer around and the
// left steers its facing and height — reads as piloting the craft, not a dot.
function setAxes(h,vx,vy){
  if(h==='L'){input.tTurn=dz(vx);input.tClimb=dz(-vy);}    // x = rotate, up = climb
  else{input.tStrafe=dz(vx);input.tFwd=dz(-vy);}           // x = strafe, up = forward
}
function clearAxes(h){ if(h==='L'){input.tTurn=0;input.tClimb=0;} else {input.tStrafe=0;input.tFwd=0;} }
// centre deadzone + rescale so a resting thumb reads as neutral and the usable
// travel still spans the full -1..1 — key to a stick that feels natural.
function dz(v){ const d=0.12, a=Math.abs(v); return a<d?0:Math.sign(v)*((a-d)/(1-d)); }

// per-half state; `ids` holds the active pointer ids that started in that half.
// The right half also tracks a double-tap so it can open the beam (see below).
const half={
  L:{ids:[],ox:0,oy:0,downT:0,moved:0},
  R:{ids:[],ox:0,oy:0,downT:0,moved:0,beamPtr:null,lastWasTap:false,lastTapT:0,lastTapX:0,lastTapY:0},
};
const ptrHalf=new Map();   // pointerId -> 'L' | 'R'
const pos=new Map();       // pointerId -> {x,y}
const TAP_MS=260, TAP_MOVE=18, DTAP_MS=320, DTAP_DIST=48;   // tap / double-tap thresholds

/* ---- press-and-hold the saucer to cloak ---- */
const _ray=new THREE.Raycaster(), _ndc=new THREE.Vector2();
let cloakPtr=null, cloakT0=0, cloakTimer=0, cloakSX=0, cloakSY=0;
function tappedSaucer(e){
  _ndc.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  _ray.setFromCamera(_ndc,camera);
  return _ray.intersectObject(saucer,true).length>0;
}
function cancelCloakHold(){ if(cloakTimer){clearTimeout(cloakTimer);cloakTimer=0;} cloakPtr=null;input.cloakProg=0; }

renderer.domElement.addEventListener('pointerdown',e=>{
  if(S.state!=='playing')return;
  // Press-and-hold on the saucer toggles cloak (works with any pointer). A press
  // that moves past SHIP_SLOP cancels — so it never fights a nearby joystick drag.
  if(tappedSaucer(e)){
    cloakPtr=e.pointerId;cloakSX=e.clientX;cloakSY=e.clientY;cloakT0=performance.now();
    cloakTimer=setTimeout(()=>{cloakTimer=0;input.cloakProg=0;cloakPtr=null;toggleCloak();},CLOAK_HOLD_MS);
    return;
  }
  if(e.pointerType==='mouse')return;                        // desktop otherwise flies by keyboard
  const h=e.clientX<innerWidth/2?'L':'R', H=half[h], now=performance.now();
  pos.set(e.pointerId,{x:e.clientX,y:e.clientY});
  ptrHalf.set(e.pointerId,h);
  H.ids.push(e.pointerId);
  if(H.ids.length===1){
    H.ox=e.clientX;H.oy=e.clientY;H.downT=now;H.moved=0;
    showJoy(h,e.clientX,e.clientY);
    // Right stick: a double-tap (this press soon after a quick tap nearby) opens
    // the beam. It stays on while this finger is held, and the stick still moves,
    // so you can beam and fly with the same thumb. Releasing stops the beam.
    if(h==='R'&&H.lastWasTap&&now-H.lastTapT<DTAP_MS&&Math.hypot(e.clientX-H.lastTapX,e.clientY-H.lastTapY)<DTAP_DIST){
      H.beamPtr=e.pointerId;input.beamHold=true;setBeaming(true);H.lastWasTap=false;
    }
  }
});

addEventListener('pointermove',e=>{
  if(e.pointerId===cloakPtr){                              // pending cloak hold
    if(Math.hypot(e.clientX-cloakSX,e.clientY-cloakSY)>SHIP_SLOP)cancelCloakHold();
    return;
  }
  if(!ptrHalf.has(e.pointerId))return;
  const p=pos.get(e.pointerId); if(p){p.x=e.clientX;p.y=e.clientY;}
  const h=ptrHalf.get(e.pointerId), H=half[h];
  if(e.pointerId!==H.ids[0])return;                        // only the anchor finger drives the stick
  const dx=e.clientX-H.ox, dy=e.clientY-H.oy;
  H.moved=Math.max(H.moved,Math.hypot(dx,dy));             // track travel to tell a tap from a drag
  const len=Math.hypot(dx,dy)||1, cl=Math.min(len,R);
  const kx=dx/len*cl, ky=dy/len*cl;
  moveKnob(h,kx,ky);
  setAxes(h,kx/R,ky/R);
},{passive:true});

function endPtr(e){
  if(e.pointerId===cloakPtr){ cancelCloakHold(); return; }
  if(!ptrHalf.has(e.pointerId))return;
  const h=ptrHalf.get(e.pointerId), H=half[h], now=performance.now();
  const wasAnchor=(H.ids[0]===e.pointerId);
  ptrHalf.delete(e.pointerId); pos.delete(e.pointerId);
  const i=H.ids.indexOf(e.pointerId); if(i>=0)H.ids.splice(i,1);
  if(h==='R'&&e.pointerId===H.beamPtr){ input.beamHold=false;H.beamPtr=null;setBeaming(false); }
  if(h==='R'&&wasAnchor){                                  // remember whether this press was a quick tap
    H.lastWasTap=(now-H.downT<TAP_MS&&H.moved<TAP_MOVE);
    H.lastTapT=now;H.lastTapX=H.ox;H.lastTapY=H.oy;
  }
  if(H.ids.length===0){ clearAxes(h); hideJoy(h); }
  else{ const p=pos.get(H.ids[0]); if(p){ H.ox=p.x;H.oy=p.y; showJoy(h,p.x,p.y); } }   // hand the stick to the remaining finger
}
addEventListener('pointerup',endPtr);
addEventListener('pointercancel',endPtr);

/* Feed the hold-to-cloak progress ring the HUD reads. */
setInterval(()=>{
  input.cloakProg=(cloakPtr!=null&&cloakTimer)?Math.min(1,(performance.now()-cloakT0)/CLOAK_HOLD_MS):0;
},33);

/* ---- zoom slider (top-right) ---- */
const zoomSlider=document.getElementById('zoomSlider');
if(zoomSlider){
  const apply=()=>{ input.zoom=+zoomSlider.value; };
  zoomSlider.addEventListener('input',apply);
  apply();
}

/* Reset all touch intents (called by startGame / respawn). */
export function resetInputTouch(){
  input.tFwd=input.tStrafe=input.tTurn=input.tClimb=0;
  input.beamHold=false;input.cloakProg=0;
  half.L.ids.length=0;half.R.ids.length=0;half.R.beamPtr=null;half.R.lastWasTap=false;
  ptrHalf.clear();pos.clear();cancelCloakHold();
  hideJoy('L');hideJoy('R');setBeaming(false);
  if(zoomSlider){ zoomSlider.value='1'; input.zoom=1; }
}
