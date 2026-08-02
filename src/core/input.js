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
     · double-tap + hold EITHER stick opens the beam (fly while beaming), so the
       beam is reachable from any point on the screen with either thumb
     · press-and-hold the SAUCER itself for 2s to toggle cloak
     · the ZOOM slider (top-right) sets the camera distance
     · when the special is charged, a glowing PULL button appears above the
       centre of the right half; press-and-hold it to unleash the Great Pull

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
  tFwd:0, tStrafe:0, tTurn:0, tClimb:0,   // MOVE axes (right stick / WSAD), each -1..1
  lookStickX:0, lookStickY:0,             // LOOK axes (left stick, mobile), -1..1 (rate)
  mDX:0, mDY:0,                            // accumulated mouse-look deltas (PC), consumed per frame
  beamHold:false, spHeld:false,
  zoom:1,                                  // camera-zoom multiplier, driven by the slider
  camPitch:0.35,                           // angle slider (kept for compatibility; look now drives pitch)
  cloakProg:0,                             // 0..1 progress of the hold-to-cloak timer (touch OR RMB)
  spinKick:0,                              // one-shot angular impulse from a swipe on the ship (rad/s)
};

export const CLOAK_HOLD_MS=2000;   // press-and-hold the saucer this long to toggle cloak
const R=68;                        // joystick radius (px) for full deflection
const SHIP_SLOP=12;                // px of travel that cancels a pending cloak hold

/* ---- rebindable key bindings ----
   Every keyboard action maps through `binds` (action id -> lowercased e.key), so
   the player can remap any of them in Settings. Defaults match the on-screen
   hints; overrides persist in localStorage. main.js reads inputs via held(). */
export const ACTIONS=[
  {id:'forward',def:'w'},       {id:'back',def:'s'},
  {id:'strafeL',def:'a'},       {id:'strafeR',def:'d'},
  {id:'ascend',def:'shift'},    {id:'descend',def:'control'},
  {id:'turnL',def:'arrowleft'}, {id:'turnR',def:'arrowright'},   // optional keyboard yaw (mouse is primary)
  {id:'beam',def:' '},          {id:'pull',def:'q'},   {id:'cloak',def:'c'},
];
const BIND_DEF={}; ACTIONS.forEach(a=>BIND_DEF[a.id]=a.def);
export const binds=Object.assign({},BIND_DEF);
// 'abductor.binds2' — bumped from the old key so the new WASD/Shift/Ctrl scheme
// is not shadowed by a player's stored pre-mouse-look bindings.
try{ const s=JSON.parse(localStorage.getItem('abductor.binds2')||'{}');
  for(const a of ACTIONS) if(typeof s[a.id]==='string') binds[a.id]=s[a.id]; }catch(e){}
export function saveBinds(){ try{localStorage.setItem('abductor.binds2',JSON.stringify(binds));}catch(e){} }
export function setBind(id,key){
  for(const a of ACTIONS) if(a.id!==id && binds[a.id]===key) binds[a.id]='';   // one key -> one action
  binds[id]=key; saveBinds();
}
export function resetBinds(){ Object.assign(binds,BIND_DEF); saveBinds(); }
export function held(id){ const k=binds[id]; return !!k && !!keys[k]; }

/* ---- touch (joystick) configuration ----
   Fully remappable sticks: each of the four physical axes (Left/Right stick,
   horizontal ◄►/vertical ▲▼) is assigned a movement FUNCTION and can be
   inverted. So the player can, e.g., steer with the left stick and strafe with
   the right. Persisted like the key binds; edited in the "Touch controls" panel.
     axis ids : LX LY RX RY           function ids : forward turn strafe climb ''  */
export const AXES=['LX','LY','RX','RY'];
export const FUNCS=['forward','turn','strafe','climb'];   // '' (none) also valid
// Default: RIGHT stick translates (strafe X / forward-back Y), LEFT stick steers
// and lifts (turn X / altitude Y). Any axis is remappable in the touch settings.
const MAP_DEF={ LX:'turn', LY:'climb', RX:'strafe', RY:'forward' };
const INV_DEF={ LX:false, LY:false, RX:false, RY:false };
export const touchMap=Object.assign({},MAP_DEF);
export const touchInv=Object.assign({},INV_DEF);
try{ const s=JSON.parse(localStorage.getItem('abductor.touch')||'{}');
  if(s.map)for(const a of AXES){ const f=s.map[a];
    if(f===''||FUNCS.includes(f))touchMap[a]=f; }
  if(s.inv)for(const a of AXES) if(typeof s.inv[a]==='boolean')touchInv[a]=s.inv[a];
}catch(e){}
export function saveTouch(){ try{localStorage.setItem('abductor.touch',
  JSON.stringify({map:touchMap,inv:touchInv}));}catch(e){} }
export function setTouchMap(axis,fn){ touchMap[axis]=fn; saveTouch(); }
export function setTouchInv(axis,v){ touchInv[axis]=!!v; saveTouch(); }
export function resetTouch(){ Object.assign(touchMap,MAP_DEF);Object.assign(touchInv,INV_DEF); saveTouch(); }
/* pretty label for a bound key, for the UI */
export function keyLabel(k){
  if(!k) return '—';
  if(k===' ') return 'Space';
  if(k==='arrowup') return '↑'; if(k==='arrowdown') return '↓';
  if(k==='arrowleft') return '←'; if(k==='arrowright') return '→';
  if(k==='escape') return 'Esc';
  return k.length===1 ? k.toUpperCase() : k.replace(/^\w/,c=>c.toUpperCase());
}
/* rebind capture: while active, the next keydown becomes the new binding */
let _capture=null;
export function beginCapture(id,done){ _capture={id,done}; }
export function cancelCapture(){ _capture=null; }
export function isCapturing(){ return !!_capture; }

addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(_capture){                                   // grabbing a key for a rebind
    e.preventDefault();
    if(k!=='escape') setBind(_capture.id,k);
    const c=_capture; _capture=null; if(c.done)c.done();
    return;
  }
  keys[k]=true;
  if(k===binds.cloak&&!e.repeat&&S.state==='playing')toggleCloak();
  if(k===' '||k.startsWith('arrow'))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});

/* ---- twin joysticks ---- */
const joyEl={L:null,R:null};
function joy(h){ if(joyEl[h]===null)joyEl[h]=document.getElementById(h==='L'?'joyL':'joyR'); return joyEl[h]; }
function showJoy(h,ox,oy){ const el=joy(h); if(!el)return; el.style.left=ox+'px';el.style.top=oy+'px';el.classList.add('on'); moveKnob(h,0,0); }
function moveKnob(h,dx,dy){ const el=joy(h); if(!el)return; const k=el.querySelector('.joy-knob'); if(k)k.style.transform='translate('+dx+'px,'+dy+'px)'; }
function hideJoy(h){ const el=joy(h); if(el)el.classList.remove('on'); }

// Every physical axis routes through its assigned function (touchMap) with an
// optional invert. Horizontal reads +right; vertical reads +up. By default the
// RIGHT thumb pilots heading/throttle and the LEFT slides/lifts, but any axis
// can be remapped, so e.g. steering can live on the left and strafing on the right.
function setFunc(fn,val){
  if(fn==='forward')input.tFwd=val;
  else if(fn==='turn')input.tTurn=val;
  else if(fn==='strafe')input.tStrafe=val;
  else if(fn==='climb')input.tClimb=val;
}
// Fixed mobile scheme (per design): LEFT stick = LOOK (x=yaw, y=pitch, like the
// PC mouse), RIGHT stick = MOVE (x=strafe, y=forward, like WSAD). Forward while
// pitched up climbs; backward while pitched down descends — falls out of the
// flight model's facing-frame thrust. (touchMap/inv kept for the settings panel
// but no longer routes flight here.)
function setAxes(h,vx,vy){
  if(h==='L'){ input.lookStickX=dz(vx); input.lookStickY=dz(vy); }   // y:+down = look down
  else       { input.tStrafe=dz(vx);    input.tFwd=dz(-vy); }        // y:+up   = forward
}
function clearAxes(h){
  if(h==='L'){ input.lookStickX=0; input.lookStickY=0; }
  else       { input.tStrafe=0;    input.tFwd=0; }
}
// centre deadzone + rescale so a resting thumb reads as neutral and the usable
// travel still spans the full -1..1 — key to a stick that feels natural.
// Small deadzone + linear response so the stick answers almost immediately.
function dz(v){ const d=0.06, a=Math.abs(v); return a<d?0:Math.sign(v)*((a-d)/(1-d)); }

/* ---- the lift slider ------------------------------------------------------
   A thin strip down the seam between the two joystick halves that drives
   ALTITUDE directly. It exists because climbing was previously only reachable
   through the flight model's facing frame — pitch the nose up with the left
   thumb, then push forward with the right — which is correct physics and a
   two-thumb negotiation for something the player wants to do while already
   doing something else.

   It is its own pointer, claimed before either half sees the press, so it
   composes with whatever the thumbs are already holding: build speed on the
   right stick, then slide up here and the ship climbs along the vector it
   already has rather than stopping to change attitude.

   Rate control, not position: the value is displacement from wherever the
   finger landed, over LIFT_TRAVEL, clamped. So a short strip still reaches full
   deflection and there is no absolute zero to hunt for. */
const LIFT_W = 56;        // px wide — a strip, not a lane; must not eat stick presses
const LIFT_TRAVEL = 90;   // px of drag for full deflection
let liftPtr=null, liftY0=0;
function inLiftStrip(x){ return Math.abs(x-innerWidth/2)<=LIFT_W/2; }
let liftEl=null;
function liftDOM(){ if(liftEl===null)liftEl=document.getElementById('liftSlider'); return liftEl; }
function showLift(on,v){
  const el=liftDOM(); if(!el)return;
  el.classList.toggle('on',!!on);
  const k=el.querySelector('.lift-knob');
  if(k)k.style.transform='translate(-50%,-50%) translateY('+(-(v||0)*38)+'px)';
}

// per-half state; `ids` holds the active pointer ids that started in that half.
// The right half also tracks a double-tap so it can open the beam (see below).
const half={
  L:{ids:[],ox:0,oy:0,downT:0,moved:0,beamPtr:null,lastWasTap:false,lastTapT:0,lastTapX:0,lastTapY:0},
  R:{ids:[],ox:0,oy:0,downT:0,moved:0,beamPtr:null,lastWasTap:false,lastTapT:0,lastTapX:0,lastTapY:0},
};
const ptrHalf=new Map();   // pointerId -> 'L' | 'R'
const pos=new Map();       // pointerId -> {x,y}
const TAP_MS=260, TAP_MOVE=18, DTAP_MS=320, DTAP_DIST=48;   // tap / double-tap thresholds

/* ---- press-and-hold the saucer to cloak ---- */
const _ray=new THREE.Raycaster(), _ndc=new THREE.Vector2();
let cloakPtr=null, cloakT0=0, cloakTimer=0, cloakSX=0, cloakSY=0;
/* ---- swipe the saucer to spin it ---- */
let shipPtr=null, shipSX=0, shipSY=0, shipT0=0, shipMoved=0;
const SHIP_SWIPE=44;      // px of horizontal travel that counts as a spin flick
const SPIN_MAX=12;        // rad/s cap on the flick's angular impulse
function tappedSaucer(e){
  _ndc.set((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
  _ray.setFromCamera(_ndc,camera);
  return _ray.intersectObject(saucer,true).length>0;
}
function cancelCloakHold(){ if(cloakTimer){clearTimeout(cloakTimer);cloakTimer=0;} cloakPtr=null;input.cloakProg=0; }

renderer.domElement.addEventListener('pointerdown',e=>{
  if(S.state!=='playing')return;
  if(e.pointerType==='mouse')return;                        // PC is handled below (mouse-look + LMB/RMB)
  // Press-and-hold on the saucer toggles cloak (touch). A press
  // that moves past SHIP_SLOP cancels — so it never fights a nearby joystick drag.
  if(tappedSaucer(e)){
    // Track this press for the swipe-to-spin flick (works regardless of cloak).
    shipPtr=e.pointerId;shipSX=e.clientX;shipSY=e.clientY;shipT0=performance.now();shipMoved=0;
    // Arm hold-to-cloak only when cloak is available; a swipe cancels it (below).
    // Cloak still locked? The tap flashes the "locked" message on release instead.
    if(S.upCloak||S.cloak){
      cloakPtr=e.pointerId;cloakSX=e.clientX;cloakSY=e.clientY;cloakT0=performance.now();
      cloakTimer=setTimeout(()=>{cloakTimer=0;input.cloakProg=0;cloakPtr=null;toggleCloak();},CLOAK_HOLD_MS);
    }
    return;
  }
  if(e.pointerType==='mouse')return;                        // desktop otherwise flies by keyboard
  /* The lift strip gets first refusal on anything landing in the seam, and the
     pointer never reaches a joystick half — otherwise a slide up here would
     also be read as a stick deflection by whichever side of centre it began. */
  if(liftPtr===null&&inLiftStrip(e.clientX)){
    liftPtr=e.pointerId; liftY0=e.clientY; input.tClimb=0;
    showLift(true,0);
    return;
  }
  const h=e.clientX<innerWidth/2?'L':'R', H=half[h], now=performance.now();
  pos.set(e.pointerId,{x:e.clientX,y:e.clientY});
  ptrHalf.set(e.pointerId,h);
  H.ids.push(e.pointerId);
  if(H.ids.length===1){
    H.ox=e.clientX;H.oy=e.clientY;H.downT=now;H.moved=0;
    showJoy(h,e.clientX,e.clientY);
    // Either stick: a double-tap (this press soon after a quick tap nearby) opens
    // the beam. It stays on while this finger is held, and the stick still moves,
    // so you can beam and fly with the same thumb. Releasing stops the beam.
    // Mirroring it to both halves lets either thumb beam from any point on screen.
    if(H.lastWasTap&&now-H.lastTapT<DTAP_MS&&Math.hypot(e.clientX-H.lastTapX,e.clientY-H.lastTapY)<DTAP_DIST){
      H.beamPtr=e.pointerId;input.beamHold=true;H.lastWasTap=false;
    }
  }
});

addEventListener('pointermove',e=>{
  if(e.pointerId===liftPtr){
    // up on screen is -y, and up is climb
    const v=Math.max(-1,Math.min(1,(liftY0-e.clientY)/LIFT_TRAVEL));
    input.tClimb=v; showLift(true,v);
    return;
  }
  if(e.pointerId===shipPtr){                               // track travel for the spin flick
    shipMoved=Math.max(shipMoved,Math.hypot(e.clientX-shipSX,e.clientY-shipSY));
  }
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
  if(e.pointerId===liftPtr){ liftPtr=null; input.tClimb=0; showLift(false,0); return; }
  if(e.pointerId===shipPtr){                               // released a press that began on the ship
    const dx=e.clientX-shipSX, dy=e.clientY-shipSY;
    const dtS=Math.max(0.05,(performance.now()-shipT0)/1000);
    shipPtr=null;
    if(Math.abs(dx)>SHIP_SWIPE&&Math.abs(dx)>Math.abs(dy)*1.1){
      // horizontal flick → spin about the ship's axis; direction follows the swipe,
      // strength follows the flick speed. main.js decays it back to rest.
      input.spinKick+=THREE.MathUtils.clamp(-(dx/dtS)*0.010,-SPIN_MAX,SPIN_MAX);
    } else if(shipMoved<SHIP_SLOP&&(performance.now()-shipT0)<TAP_MS&&!S.upCloak&&!S.cloak){
      toggleCloak();                                       // a tap while cloak is locked flashes the message
    }
    // fall through so any cloak hold armed on this same pointer is cleaned up
  }
  if(e.pointerId===cloakPtr){ cancelCloakHold(); return; }
  if(!ptrHalf.has(e.pointerId))return;
  const h=ptrHalf.get(e.pointerId), H=half[h], now=performance.now();
  const wasAnchor=(H.ids[0]===e.pointerId);
  ptrHalf.delete(e.pointerId); pos.delete(e.pointerId);
  const i=H.ids.indexOf(e.pointerId); if(i>=0)H.ids.splice(i,1);
  if(e.pointerId===H.beamPtr){                             // this finger was holding the beam
    H.beamPtr=null;
    input.beamHold=(half.L.beamPtr!=null||half.R.beamPtr!=null);   // keep on if the other thumb still holds
  }
  if(wasAnchor){                                           // remember whether this press was a quick tap
    H.lastWasTap=(now-H.downT<TAP_MS&&H.moved<TAP_MOVE);
    H.lastTapT=now;H.lastTapX=H.ox;H.lastTapY=H.oy;
  }
  if(H.ids.length===0){ clearAxes(h); hideJoy(h); }
  else{ const p=pos.get(H.ids[0]); if(p){ H.ox=p.x;H.oy=p.y; showJoy(h,p.x,p.y); } }   // hand the stick to the remaining finger
}
addEventListener('pointerup',endPtr);
addEventListener('pointercancel',endPtr);

/* ---- PC: pointer-lock mouse-look + LMB beam + RMB hold-2s cloak ---- */
let locked=false, pcCloakTimer=0, pcCloakT0=0;
const MOUSE_SENS=0.0022;                 // radians per pixel, before the model's turnRate
function cancelPcCloak(){ if(pcCloakTimer){clearTimeout(pcCloakTimer);pcCloakTimer=0;} pcCloakT0=0; }
document.addEventListener('pointerlockchange',()=>{
  locked=document.pointerLockElement===renderer.domElement;
  if(!locked){ input.beamHold=false; cancelPcCloak(); }
});
renderer.domElement.addEventListener('mousedown',e=>{
  if(S.state!=='playing')return;
  if(!locked){ renderer.domElement.requestPointerLock(); return; }   // first click grabs the mouse
  if(e.button===0){ input.beamHold=true; }
  else if(e.button===2){
    if(!S.upCloak&&!S.cloak){ toggleCloak(); return; }               // locked: just flash the message
    pcCloakT0=performance.now();
    pcCloakTimer=setTimeout(()=>{ pcCloakTimer=0; pcCloakT0=0; toggleCloak(); },CLOAK_HOLD_MS);
  }
});
addEventListener('mouseup',e=>{
  if(e.button===0)input.beamHold=false;
  else if(e.button===2)cancelPcCloak();
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousemove',e=>{
  if(!locked)return;
  input.mDX+=e.movementX*MOUSE_SENS;
  input.mDY+=e.movementY*MOUSE_SENS;
});

/* Feed the hold-to-cloak progress ring the HUD reads (touch saucer-hold OR RMB). */
setInterval(()=>{
  let p=0;
  if(cloakPtr!=null&&cloakTimer)p=(performance.now()-cloakT0)/CLOAK_HOLD_MS;
  if(pcCloakTimer&&pcCloakT0)p=Math.max(p,(performance.now()-pcCloakT0)/CLOAK_HOLD_MS);
  input.cloakProg=Math.min(1,p);
},33);

/* ---- zoom slider (top-right) ---- */
const zoomSlider=document.getElementById('zoomSlider');
if(zoomSlider){
  const apply=()=>{ input.zoom=+zoomSlider.value; };
  zoomSlider.addEventListener('input',apply);
  apply();
}

/* ---- camera-angle slider (vertical, beside the zoom slider) ----
   Tilts the chase camera between the behind-the-ship view (bottom) and a
   top-down view (top). The <input> value runs 0..1 bottom→top. */
const angleSlider=document.getElementById('angleSlider');
if(angleSlider){
  const apply=()=>{ input.camPitch=+angleSlider.value; };
  angleSlider.addEventListener('input',apply);
  apply();
}

/* Reset all touch intents (called by startGame / respawn). */
export function resetInputTouch(){
  input.tFwd=input.tStrafe=input.tTurn=input.tClimb=0;
  input.lookStickX=input.lookStickY=input.mDX=input.mDY=0;
  input.beamHold=false;input.spHeld=false;input.cloakProg=0;input.spinKick=0;shipPtr=null;cancelPcCloak();
  half.L.ids.length=0;half.R.ids.length=0;
  half.L.beamPtr=null;half.L.lastWasTap=false;half.R.beamPtr=null;half.R.lastWasTap=false;
  ptrHalf.clear();pos.clear();cancelCloakHold();
  hideJoy('L');hideJoy('R');
  if(zoomSlider){ zoomSlider.value='1'; input.zoom=1; }
  // camera angle is a viewing preference — leave it where the player set it.
}
