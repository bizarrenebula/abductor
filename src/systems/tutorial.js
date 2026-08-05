/* =========================================================================
   TUTORIAL — an optional, short guided intro played in the real open world.
   Offered on Play; if taken it walks the player through seventeen steps as a
   journey across all three lands — look and fly in the desert, cross to the
   wilderness for the beam, cross again to the towns for the cloak, then five
   short reading steps on the HUD — and finally offers Keep exploring / Restart
   tutorial / Main menu. Crashes are disabled for the whole run (see the
   S.tutorial guards in collision, main, meteors, geysers and lightning).
   Entirely self-contained: it builds its own DOM (start prompt, HUD hint card,
   joystick guide, choice modal) plus a world beacon, creature marker and a
   guaranteed lesson crystal, so nothing else in the UI needs to know about it.

   Wiring: screens.js calls Tutorial.prompt() from the Play button; main.js
   calls Tutorial.update(dt) each playing frame; startGame() calls Tutorial.stop().
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { saucer } from './saucer.js';
import { TOUCH_ONLY } from '../core/env.js';
import { heightAt, goodGround } from '../world/terrain.js';
import { animals, pickups } from '../entities/registry.js';
import { buildCrystal } from '../entities/crystals.js';
import { buildAnimal } from '../entities/animals.js';
import { buildHuman } from '../entities/humans.js';
import { upgradeItems } from '../entities/upgradeItems.js';
import { banner } from '../ui/banner.js';
import { Special } from './special.js';
import { Upgrades, UP_ITEMS } from './upgrades.js';
import { mark as markWaypoint, objectiveGlow, updateGlow } from './waypoints.js';
import { lanePoint, laneHeading } from '../world/lane.js';
import { regionAt, regionWeights, WILD, URBAN } from '../world/regions.js';

const TOUCH = TOUCH_ONLY;   // pick touch vs keyboard wording for the hints

/* ---- styles + DOM (built once, lazily) ------------------------------------ */
let dom=null;
function build(){
  if(dom)return dom;
  const css=document.createElement('style');
  css.textContent=`
  .tut-modal{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
    background:rgba(2,6,4,.66);backdrop-filter:blur(3px);font-family:inherit}
  .tut-modal.on{display:flex}
  .tut-card{width:min(340px,86vw);background:rgba(6,12,10,.96);border:1px solid rgba(143,232,184,.28);
    border-radius:16px;padding:22px 20px 18px;text-align:center;color:#dfeee6;
    box-shadow:0 24px 70px rgba(0,0,0,.6),inset 0 0 30px rgba(89,255,176,.05)}
  .tut-eyebrow{font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:rgba(143,232,184,.7)}
  .tut-title{font-size:19px;font-weight:800;letter-spacing:.04em;margin:6px 0 8px;color:#eafff4}
  .tut-body{font-size:12.5px;line-height:1.5;color:#b9ccc2;margin-bottom:16px}
  .tut-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  .tut-btn{font-family:inherit;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    padding:11px 16px;border-radius:10px;cursor:pointer;border:1px solid rgba(143,232,184,.3);
    background:rgba(143,232,184,.08);color:#cdEFDD}
  .tut-btn:hover{border-color:rgba(143,232,184,.7);color:#eafff4}
  .tut-btn.primary{background:linear-gradient(#2aa877,#1c7d59);border-color:rgba(143,232,184,.6);
    color:#04120c;text-shadow:none;box-shadow:0 0 20px rgba(89,255,176,.35)}
  /* HUD hint card — pinned top-centre, never intercepts joystick touches */
  #tutHint{position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:40;pointer-events:none;
    width:min(360px,90vw);text-align:center;font-family:inherit;display:none}
  #tutHint.on{display:block}
  .tut-step{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:rgba(143,232,184,.75);
    margin-bottom:3px}
  .tut-task{font-size:15px;font-weight:800;color:#eafff4;text-shadow:0 2px 10px rgba(0,0,0,.7);margin-bottom:2px}
  .tut-do{font-size:12px;color:#cfe6db;text-shadow:0 1px 8px rgba(0,0,0,.8)}
  /* One dot per step, and there are twelve — so they share the card's width
     rather than each claiming 22px, which overflowed on a narrow phone. */
  .tut-dots{margin-top:8px;display:flex;gap:4px;justify-content:center}
  .tut-dot{flex:1 1 0;min-width:6px;max-width:22px;height:4px;border-radius:2px;
    background:rgba(143,232,184,.22)}
  .tut-dot.done{background:rgba(143,232,184,.9)}
  .tut-dot.now{background:rgba(143,232,184,.55)}

  /* ---- animated joystick demo (touch devices) ----------------------------
     Shows WHICH half of the screen drives the current task and animates a ghost
     stick doing the motion being taught. Purely decorative: pointer-events are
     off everywhere, so real touches pass straight through to the game. */
  #tutJoy{position:fixed;inset:0;z-index:38;pointer-events:none;display:none}
  #tutJoy.on{display:block}
  /* dashed split: the screen's left/right touch halves */
  #tutJoy .tut-split{position:absolute;left:50%;top:0;bottom:0;width:0;
    border-left:1px dashed rgba(143,232,184,.28)}
  /* the highlighted half for the current task */
  #tutJoy .tut-half{position:absolute;top:0;bottom:0;width:50%;opacity:0;transition:opacity .35s;
    background:linear-gradient(to bottom,rgba(143,232,184,0),rgba(143,232,184,.09) 55%,rgba(143,232,184,.14))}
  #tutJoy .tut-half.left{left:0}  #tutJoy .tut-half.right{right:0}
  #tutJoy .tut-half.on{opacity:1}
  /* ghost stick, parked in the natural thumb spot of its half */
  /* sat high enough to clear the bottom-left HUD (collectible list + minimap) */
  #tutJoy .tut-stick{position:absolute;bottom:30%;width:118px;height:118px;opacity:0;
    transition:opacity .35s}
  #tutJoy .tut-stick.left{left:25%;margin-left:-59px}
  #tutJoy .tut-stick.right{left:75%;margin-left:-59px}
  #tutJoy .tut-stick.on{opacity:1}
  /* the player has taken hold and the linger elapsed: ease back to a faint marker
     of the zone instead of covering the view — it clears fully on task completion */
  #tutJoy.engaged .tut-half.on{opacity:.3}
  #tutJoy.engaged .tut-stick.on{opacity:.34}

  /* HUD staging: the minimap stays out of the way while the player learns to
     fly, then is revealed (and explained) at the end. The equipment checklist
     used to be staged alongside it; it no longer exists as a panel, and the
     three glyphs that replaced it stage themselves — they are only ever on
     screen in response to something the player just did. */
  body.tut-no-map #minimap{display:none!important}
  /* a soft ring drawing the eye to whatever was just revealed */
  @keyframes tutReveal{0%{box-shadow:0 0 0 0 rgba(143,232,184,.55)}
    70%{box-shadow:0 0 0 16px rgba(143,232,184,0)} 100%{box-shadow:0 0 0 0 rgba(143,232,184,0)}}
  body.tut-point-map #minimap{border-radius:50%;animation:tutReveal 1.6s ease-out 3}
  /* the PULL button keeps pulsing until the player actually uses it */
  body.tut-point-pull #spBtn{animation:tutReveal 1.6s ease-out infinite}
  #tutJoy .tut-base{position:absolute;inset:0;border-radius:50%;
    border:1.5px solid rgba(143,232,184,.34);background:rgba(143,232,184,.055);
    box-shadow:inset 0 0 22px rgba(143,232,184,.08),0 0 18px rgba(0,0,0,.35)}
  #tutJoy .tut-knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;
    border-radius:50%;background:radial-gradient(circle at 40% 34%,#bff5dd,#3f8f6c 72%);
    box-shadow:0 0 18px rgba(143,232,184,.55),inset 0 0 10px rgba(0,0,0,.35)}
  #tutJoy .tut-lbl{position:absolute;left:50%;transform:translateX(-50%);top:-30px;white-space:nowrap;
    font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#8fe8b8;
    background:rgba(5,12,10,.55);border:1px solid rgba(143,232,184,.22);border-radius:20px;
    padding:5px 10px;text-shadow:0 0 10px rgba(0,0,0,.8)}
  /* per-task knob motion */
  #tutJoy[data-anim=look]  .tut-stick.left  .tut-knob{animation:tutLook 4.4s ease-in-out infinite}
  #tutJoy[data-anim=move]  .tut-stick.right .tut-knob{animation:tutMove 3.2s ease-in-out infinite}
  #tutJoy[data-anim=alt]   .tut-stick.left  .tut-knob{animation:tutAlt  2.6s ease-in-out infinite}
  #tutJoy[data-anim=beam]  .tut-stick.right .tut-knob{animation:tutTap  2.8s ease-in-out infinite}
  /* look: sweep left, right, up, down — the four directions of the look stick */
  @keyframes tutLook{ 0%,5%{transform:translate(0,0)} 15%{transform:translate(-33px,0)}
    30%{transform:translate(33px,0)} 43%,48%{transform:translate(0,0)}
    58%{transform:translate(0,-31px)} 73%{transform:translate(0,31px)} 88%,100%{transform:translate(0,0)} }
  @keyframes tutMove{ 0%,8%{transform:translate(0,0)} 26%,38%{transform:translate(0,-34px)}
    56%{transform:translate(30px,-16px)} 74%{transform:translate(-30px,-16px)} 92%,100%{transform:translate(0,0)} }
  @keyframes tutAlt{ 0%,10%{transform:translate(0,0)} 32%,46%{transform:translate(0,-36px)}
    68%,82%{transform:translate(0,36px)} 96%,100%{transform:translate(0,0)} }
  /* tap · tap · hold — two quick dips, then a long held press */
  @keyframes tutTap{ 0%,6%{transform:scale(1);filter:brightness(1)}
    12%{transform:scale(.82);filter:brightness(1.5)} 20%{transform:scale(1);filter:brightness(1)}
    28%{transform:scale(.82);filter:brightness(1.5)}
    36%,86%{transform:scale(.9);filter:brightness(1.85)} 96%,100%{transform:scale(1);filter:brightness(1)} }
  `;
  document.head.appendChild(css);

  const hint=document.createElement('div');hint.id='tutHint';
  hint.innerHTML='<div class="tut-step"></div><div class="tut-task"></div><div class="tut-do"></div><div class="tut-dots"></div>';
  document.body.appendChild(hint);

  const joy=document.createElement('div');joy.id='tutJoy';
  joy.innerHTML=
    '<div class="tut-split"></div>'+
    '<div class="tut-half left"></div><div class="tut-half right"></div>'+
    '<div class="tut-stick left"><div class="tut-lbl">left · look &amp; altitude</div>'+
      '<div class="tut-base"></div><div class="tut-knob"></div></div>'+
    '<div class="tut-stick right"><div class="tut-lbl">right · move</div>'+
      '<div class="tut-base"></div><div class="tut-knob"></div></div>';
  document.body.appendChild(joy);

  const modal=document.createElement('div');modal.className='tut-modal';
  modal.innerHTML='<div class="tut-card"><div class="tut-eyebrow"></div><div class="tut-title"></div><div class="tut-body"></div><div class="tut-row"></div></div>';
  document.body.appendChild(modal);

  dom={
    hint, modal, joy,
    step:hint.querySelector('.tut-step'), task:hint.querySelector('.tut-task'),
    doo:hint.querySelector('.tut-do'), dots:hint.querySelector('.tut-dots'),
    eyebrow:modal.querySelector('.tut-eyebrow'), title:modal.querySelector('.tut-title'),
    body:modal.querySelector('.tut-body'), row:modal.querySelector('.tut-row'),
    halves:joy.querySelectorAll('.tut-half'), sticks:joy.querySelectorAll('.tut-stick'),
  };
  return dom;
}
/* Light up one half of the screen + its ghost stick, running `anim`'s motion.
   side: 'left' | 'right' | null (hide). Touch devices only.

   LIFECYCLE: the guide stays up while the player works the step — it does not
   vanish the instant they touch down. The first touch on the demoed half starts
   a linger; once that elapses the guide eases back to a faint state so it stops
   covering the view but still marks the zone. It only disappears outright when
   the step's actions are done (the next step swaps in its own guide, and the
   final step's completion tears it down). */
const JOY_LINGER=2600;                 // ms the guide stays at full strength after first touch
let joySide=null, joyDimT=0;
function showJoyDemo(side,anim){
  const d=build();
  clearTimeout(joyDimT);
  d.joy.classList.remove('engaged');   // fresh step → full-strength guide again
  joySide=(TOUCH&&side)?side:null;
  if(!joySide){                        // steps with no stick lesson (or desktop): clear it out
    d.joy.classList.remove('on'); d.joy.dataset.anim='';
    d.halves.forEach(el=>el.classList.remove('on'));
    d.sticks.forEach(el=>el.classList.remove('on'));
    return;
  }
  d.joy.classList.add('on');
  d.joy.dataset.anim=anim||'';
  d.halves.forEach(el=>el.classList.toggle('on',el.classList.contains(side)));
  d.sticks.forEach(el=>el.classList.toggle('on',el.classList.contains(side)));
}
/* Passive, capture-phase: observes touches without consuming them, so the game's
   own joysticks still receive every pointer event. */
addEventListener('pointerdown',e=>{
  if(!joySide)return;
  const half=(e.clientX<innerWidth/2)?'left':'right';
  if(half!==joySide)return;
  joySide=null;                        // only the FIRST touch on this half arms the fade
  clearTimeout(joyDimT);
  joyDimT=setTimeout(()=>{ if(dom)dom.joy.classList.add('engaged'); },JOY_LINGER);
},{passive:true,capture:true});
/* Show a modal with a set of {label, primary, onClick} buttons. */
function showModal(eyebrow,title,body,buttons){
  const d=build();
  d.eyebrow.textContent=eyebrow; d.title.textContent=title; d.body.textContent=body;
  d.row.innerHTML='';
  for(const b of buttons){
    const el=document.createElement('button');
    el.className='tut-btn'+(b.primary?' primary':'');
    el.textContent=b.label;
    el.addEventListener('click',()=>{ hideModal(); b.onClick(); });
    d.row.appendChild(el);
  }
  d.modal.classList.add('on');
}
function hideModal(){ if(dom)dom.modal.classList.remove('on'); }

/* ---- HUD staging ----------------------------------------------------------
   During the flying lessons the minimap is hidden so the player has nothing to
   read but the task; it is revealed at the end with its own explanation.
   `point` pulses a highlight ring around whatever was just revealed. */
function hud({map=false,point=null}={}){
  const b=document.body.classList;
  b.toggle('tut-no-map',!map);
  b.toggle('tut-point-map',point==='map');
  b.toggle('tut-point-pull',point==='pull');
}
function hudRestore(){
  document.body.classList.remove('tut-no-map','tut-point-map','tut-point-pull');
}

/* ---- world beacon (the navigation target) --------------------------------- */
let beacon=null;
/* The beacon used to be a 190-unit column that speared straight through the
   screen and blocked the view. It is a PULSE now: light breathing out of the
   spot on the ground, the same language every other object of interest uses.
   The screen arrow already carries the direction, so this only has to say
   "here". */
function makeBeacon(){
  if(beacon)return beacon;
  const g=new THREE.Group();
  g.add(objectiveGlow(0x6cf0c4,2.4));                  // shared breathing halo + ground ring
  // expanding rings that wash outward from the spot, like a slow sonar ping
  const rings=[];
  for(let i=0;i<3;i++){
    const r=new THREE.Mesh(new THREE.RingGeometry(1,1.34,44),
      new THREE.MeshBasicMaterial({color:0x9dffe0,transparent:true,opacity:0.6,
        blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    r.rotation.x=-Math.PI/2; r.position.y=0.3; g.add(r); rings.push(r);
  }
  g.userData.rings=rings;
  g.visible=false; scene.add(g); beacon=g; return g;
}
/* Breathe the beacon: the shared glow plus outward-washing pings. */
function updateBeacon(t){
  if(!beacon||!beacon.visible)return;
  updateGlow(beacon.children[0],t,1);
  const rings=beacon.userData.rings;
  for(let i=0;i<rings.length;i++){
    const k=((t*0.55+i/rings.length)%1);               // 0 at the centre, 1 fully washed out
    const s=1.5+k*13;
    rings[i].scale.setScalar(s);
    rings[i].material.opacity=0.55*(1-k)*(1-k);        // fade as it spreads
  }
}
function placeBeacon(x,z){
  const b=makeBeacon();
  b.position.set(x,heightAt(x,z),z); b.visible=true;
}

/* ---- crossing into a land ------------------------------------------------
   The tutorial is a journey now, not a checklist: the ship is set down in the
   desert, learns to fly there, crosses into the wilderness to learn the beam on
   something that stands still, and crosses again into settled country to learn
   the cloak on people who run. Each act is taught where its lesson belongs,
   which is also the reason the lane exists — world/lane.js already guarantees
   the route passes through all three (measured 40/40 seeds). */
function nextLandPoint(want){
  /* The NEAREST bit of that land, biased toward the lane's heading — not the
     first lane point that happens to stand in it. Taking the lane point put one
     beacon 2826m out because the lane strides 300-560m at a time and can
     overshoot a whole region; the crossing completes on ENTERING the land
     anyway, so a beacon far beyond the border only makes the leg look longer
     than it is. Sweeping outward keeps the walk honest.

     Bearings are ordered outward from the lane heading, so among equally near
     candidates the one that continues the run's direction wins. */
  const base=laneHeading();
  for(let r=180;r<6000;r+=60){
    for(let k=0;k<16;k++){
      // 0, +1, -1, +2, -2 ... in steps of 22.5 degrees off the lane
      const step=Math.ceil(k/2)*(k%2?1:-1);
      const a=base+step*0.3927;
      const x=saucer.position.x+Math.cos(a)*r, z=saucer.position.z+Math.sin(a)*r;
      if(regionAt(x,z)!==want)continue;
      if(!goodGround(x,z))continue;
      return {x,z};
    }
  }
  return null;
}
/* A "get there" step: a beacon on the far land, done when the ship is standing
   in it. Shared by both crossings so the two read identically. */
function crossStep(key,task,want,line){
  /* No joystick guide here. The move guide was shown once, on the step that
     taught moving; repeating it every time a later step happens to involve
     flying is coaching someone through something they already did. The player
     will also work out on their own that both sticks can climb — that is a
     discovery, not a lesson, and it does not need a diagram either. */
  return { key, task, hud:{map:true},
    say(s){
      if(!s.pt)return line;
      const d=Math.round(Math.hypot(saucer.position.x-s.pt.x,saucer.position.z-s.pt.z));
      return line+' — '+d+' m.';
    },
    begin(s){ s.pt=nextLandPoint(want); if(s.pt)placeBeacon(s.pt.x,s.pt.z); },
    test(s){
      if(beacon&&beacon.visible){updateBeacon(performance.now()*0.001);markWaypoint(beacon.position,'#6cf0c4',24);}
      return regionAt(saucer.position.x,saucer.position.z)===want;
    },
    end(){ if(beacon)beacon.visible=false; } };
}

/* DEEP INTO THE LAND, not just over its border.

   A crossing step completes the moment the ship ENTERS the next region, so the
   ship is always standing on the boundary when the next step begins — and the
   old fetch step then put the module 190m ahead of that. The player crossed
   into the wilderness and picked the beam up while the desert was still behind
   them, which makes the trip a formality and the land a doorway rather than a
   place.

   So a module is placed where its land is most itself: sweep forward along the
   lane heading through a distance band and keep the candidate with the highest
   region weight. Weight, not the biome label — the label flips at the middle of
   the blend, so a point can read 'plains' while still being mostly desert
   underneath, which is exactly the border we are trying to get away from. */
function landCentre(want,minD,maxD){
  const base=laneHeading();
  let best=null,bw=-1;
  for(let r=minD;r<=maxD;r+=45){
    for(let k=0;k<12;k++){
      const step=Math.ceil(k/2)*(k%2?1:-1);          // 0, +1, -1, +2 ... off the lane
      const a=base+step*0.35;
      const x=saucer.position.x+Math.cos(a)*r, z=saucer.position.z+Math.sin(a)*r;
      if(regionAt(x,z)!==want)continue;
      if(!goodGround(x,z))continue;
      const W=regionWeights(x,z);
      const w=want===WILD?W.wild:want===URBAN?W.urb:W.des;
      /* >=, not >. The weight saturates at 1.0 well before the band's far end,
         so a strict > kept the FIRST fully-inside point — 220m from a border
         the ship is already standing on. Since the sweep runs outward, letting
         ties win pushes the module to the deepest point that is still properly
         inside the land, which is what "the middle of the biome" means. */
      if(w>=bw){bw=w;best={x,z,w};}
    }
  }
  return best;
}

/* A "go and get it" step for one ship module. The module is already out in the
   world on the lane like every other; this drags it into the heart of the land
   the lesson belongs to — the same module in the same run, somewhere that reads
   as arriving rather than as stopping at the gate. */
function fetchStep(key,task,line){
  return { key:'get_'+key, task, hud:{map:true},
    say(s){
      if(!s.item)return line+'.';
      const d=Math.round(Math.hypot(saucer.position.x-s.item.position.x,
                                    saucer.position.z-s.item.position.z));
      return line+' — '+d+' m. Fly low over it.';
    },
    begin(s){
      s.item=upgradeItems.find(o=>o.userData.key===key)||null;
      if(s.item){
        const want=regionAt(saucer.position.x,saucer.position.z);
        const c=landCentre(want,220,620)
             || landCentre(want,150,900);            // thin land: take what there is
        if(c)s.item.position.set(c.x,Math.max(heightAt(c.x,c.z),0),c.z);
      }
    },
    test(s){
      if(s.item&&s.item.parent)markWaypoint(s.item.position,'#'+UP_ITEMS[key].col.toString(16).padStart(6,'0'),18);
      return !!Upgrades.items[key];
    } };
}

/* ---- the reading steps ---------------------------------------------------
   The closing steps are not tasks, they are text, and they hold for a fixed ten
   seconds each. A tap-to-advance version read better on paper and worse in the
   hand: the player is flying while they read, and a stray touch on the stick
   walked them through three cards at once. A countdown never does that, and ten
   seconds is long enough to read a card twice. */
const DWELL=10;
const dwellBegin=function(s){ s.t=DWELL; };
const dwellTest=(s,dt)=>{ s.t-=dt; return s.t<=0; };
const CLOCK=s=>' ('+Math.ceil(Math.max(0,s.t))+'s)';

/* ---- creature marker (a "beam this one" pointer for the final step) -------- */
let marker=null;
function makeMarker(){
  if(marker)return marker;
  const g=new THREE.Group();
  const ring=new THREE.Mesh(new THREE.TorusGeometry(2.4,0.32,10,32),
    new THREE.MeshBasicMaterial({color:0xffe28a,transparent:true,opacity:0.9,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  ring.rotation.x=Math.PI/2; g.add(ring);
  const tick=new THREE.Mesh(new THREE.ConeGeometry(1.3,2.4,4),
    new THREE.MeshBasicMaterial({color:0xfff2c0,transparent:true,opacity:0.9,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  tick.rotation.x=Math.PI; tick.position.y=3.2; g.add(tick);   // ▼ pointing down at the creature
  g.visible=false; scene.add(g); marker=g; return g;
}
/* The first catch has to be winnable, and it has to be something that is
   actually THERE. Every run now starts in deep desert, where the only two
   animals are the vulture and the camel — a vulture hovers at 17 and never
   touches the ground, and camels are a kilometre apart. So the beam lesson does
   not happen in the desert at all: the tutorial walks the player into the
   WILDERNESS first, and teaches it on a SHEEP, which stands still and comes in
   flocks.

   One is placed nearby if the chunk happened not to roll any. Strictly a camel,
   so the on-screen hint can name it. */
let tutSheep=null;                                // (the lesson animal, whatever it is)
const LESSON_SPECIES='Sheep';
function ensureSheep(){
  let best=null,bd=1e9;
  for(const a of animals){
    if(a.visible===false||!a.parent)continue;
    if(a.userData.name!==LESSON_SPECIES)continue;   // not a vulture, bird or duck
    const d=Math.hypot(a.position.x-saucer.position.x,a.position.z-saucer.position.z);
    if(d<bd){bd=d;best=a;}
  }
  if(best&&bd<200)return best;
  // none in reach — place one on decent ground a short flight away
  const D=110;
  let x=saucer.position.x+Math.sin(S.yaw)*D, z=saucer.position.z+Math.cos(S.yaw)*D;
  for(let k=0;k<14;k++){
    const a=S.yaw+k*0.45, tx=saucer.position.x+Math.sin(a)*D, tz=saucer.position.z+Math.cos(a)*D;
    if(goodGround(tx,tz)){ x=tx; z=tz; break; }
  }
  const g=buildAnimal(LESSON_SPECIES);
  g.position.set(x,heightAt(x,z),z);
  g.rotation.y=g.userData.face||0;
  scene.add(g); animals.push(g);
  tutSheep=g;
  return g;
}
/* The cloak lesson wants a PERSON under the marker, not a sheep — they are the
   only quarry that runs, which is the entire point of the lesson. */
let tutHuman=null;
/* THE QUARRY HAS TO BE A FLIGHT AWAY.

   The cloak module and the person to practise it on used to be dropped within a
   hundred metres of each other, so the lesson read: pick up the cloak, turn
   round, go dark, take the villager standing right there. Nothing was learned,
   because the cloak was never actually DOING anything — you were invisible for
   two seconds over open ground.

   The point of the module is that you can cross country nobody wants you in.
   So the target sits between MIN and MAX metres from where the cloak was
   collected: far enough that the flight is the lesson, near enough that it is
   still one leg and not a second expedition. */
const HUNT_MIN=300, HUNT_MAX=500;
function trackHuman(s){
  const m=makeMarker();
  const ok=a=>a&&a.parent&&a.visible!==false;
  if(!ok(s.target)){
    // measured from where the step began — i.e. where the cloak was picked up
    const ox=s.fromX!=null?s.fromX:saucer.position.x;
    const oz=s.fromZ!=null?s.fromZ:saucer.position.z;
    /* Prefer a REAL villager standing in the band. Everyone lives beside a
       building now, so a person that far out is a person outside their own
       house — which is a better thing to sneak up on than one conjured for the
       occasion. */
    let best=null,bd=1e9;
    for(const a of animals){
      if(!ok(a)||!a.userData.humanKind)continue;
      const d=Math.hypot(a.position.x-ox,a.position.z-oz);
      if(d<HUNT_MIN||d>HUNT_MAX)continue;
      if(d<bd){bd=d;best=a;}
    }
    if(!best){
      // Nobody out there. Place one, at the far end of the band, on the lane so
      // the flight continues the run's direction rather than doubling back.
      const D=(HUNT_MIN+HUNT_MAX)/2;
      const base=laneHeading();
      let x=ox+Math.cos(base)*D, z=oz+Math.sin(base)*D;
      for(let k=0;k<16;k++){
        const step=Math.ceil(k/2)*(k%2?1:-1);
        const a=base+step*0.3;
        const tx=ox+Math.cos(a)*D, tz=oz+Math.sin(a)*D;
        if(goodGround(tx,tz)){ x=tx; z=tz; break; }
      }
      const g=buildHuman('hiker');
      g.position.set(x,heightAt(x,z),z);
      g.rotation.y=g.userData.face||0;
      scene.add(g); animals.push(g); tutHuman=g; best=g;
    }
    s.target=best;
  }
  if(s.target){ m.visible=true;
    const bob=Math.sin(performance.now()*0.005)*0.5;
    m.position.set(s.target.position.x,s.target.position.y+5+bob,s.target.position.z);
    // ...and put them on the map, so the flight over is navigable rather than a hunt
    markWaypoint(m.position,'#ffe28a',20);
  } else m.visible=false;
}

/* Keep the marker floating over the creature the lesson wants beamed. */
function trackMarker(s){
  const m=makeMarker();
  let tgt=s.target;
  const ok=a=>a&&a.parent&&a.visible!==false;
  if(!ok(tgt))tgt=s.target=ensureSheep();
  if(tgt){ m.visible=true;
    const bob=Math.sin(performance.now()*0.005)*0.5;
    m.position.set(tgt.position.x,tgt.position.y+5+bob,tgt.position.z);
    const p=0.85+0.15*Math.sin(performance.now()*0.008);
    m.scale.setScalar(p);
    markWaypoint(m.position,'#ffe28a',18);   // arrow to the creature you must beam
  } else m.visible=false;
}


/* ---- tutorial crystal --------------------------------------------------
   Crystals spawn at random across the map, so the lesson cannot rely on one
   being nearby: reuse the nearest live crystal if there is one, otherwise place
   a fresh one just ahead. Removed again on stop() if it was never collected. */
let tutCrystal=null;
function ensureCrystal(){
  let best=null,bd=1e9;
  for(const p of pickups){
    const d=Math.hypot(p.position.x-saucer.position.x,p.position.z-saucer.position.z);
    if(d<bd){bd=d;best=p;}
  }
  if(best&&bd>40&&bd<230)return best;          // one already at a useful distance
  // Otherwise place one far enough to be a short flight, on ground it can sit on.
  const D=165;
  let x=saucer.position.x+Math.sin(S.yaw-0.7)*D, z=saucer.position.z+Math.cos(S.yaw-0.7)*D;
  for(let k=0;k<14;k++){
    const a=S.yaw-0.7+k*0.45, tx=saucer.position.x+Math.sin(a)*D, tz=saucer.position.z+Math.cos(a)*D;
    if(goodGround(tx,tz)){ x=tx; z=tz; break; }
  }
  const g=buildCrystal();
  const by=heightAt(x,z)-0.45;
  g.position.set(x,by,z); g.userData.baseY=by;
  scene.add(g); pickups.push(g);
  tutCrystal=g;
  return g;
}

/* ---- the tutorial steps --------------------------------------------------- */
const _p=new THREE.Vector3();
const BANNER_HOLD=3.5;   // seconds the closing banner sits before the choice modal
const steps=[
  // 1 — LOOK. Nothing but the view: sweep the camera all four ways first, so the
  // player learns the left half before anything is asked of the right.
  { key:'look', task:'Look around', joy:{side:'left',anim:'look'}, hud:{},
    say(s){ const need=[];
            if(!s.yawOK)need.push('left and right');
            if(!s.pitchOK)need.push('up and down');
            const what=need.join(', then ')||'around';
            return TOUCH?('Drag on the LEFT half to look '+what+'.')
                        :('Move the mouse to look '+what+'.'); },
    begin(s){ s.yawAcc=0; s.lastYaw=S.yaw; s.minP=s.maxP=S.pitch||0; s.yawOK=false; s.pitchOK=false; },
    test(s){
      let d=S.yaw-s.lastYaw;                       // shortest way round, so wrapping never spikes it
      while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
      s.yawAcc+=Math.abs(d); s.lastYaw=S.yaw;
      const p=S.pitch||0; if(p<s.minP)s.minP=p; if(p>s.maxP)s.maxP=p;
      s.yawOK=s.yawAcc>=2.2; s.pitchOK=(s.maxP-s.minP)>=0.30;
      return s.yawOK&&s.pitchOK; } },
  // 2 — MOVE (right half).
  { key:'move', task:'Take the controls', joy:{side:'right',anim:'move'}, hud:{},
    say:()=>TOUCH?'Drag the RIGHT half to fly.'
                 :'Fly with W A S D.',
    begin(s){ s.acc=0; s.last=saucer.position.clone(); },
    test(s){ s.acc+=Math.hypot(saucer.position.x-s.last.x,saucer.position.z-s.last.z);
             s.last.copy(saucer.position); return s.acc>=55; } },
  /* 3 — ALTITUDE, and the only place the lift slider is ever mentioned. It is
     an invisible control — a strip down the seam between the two thumb halves —
     so it has to be taught once, early, before anything else needs height.
     Climbing used to mean pitching up on the left and thrusting on the right, a
     two-thumb negotiation for something you want while already doing something
     else; the slider is a third finger that composes with both. */
  /* THRUSTERS FIRST, then altitude. The order is the whole point: the module
     IS the ability, so being taught to climb before owning the thing that
     climbs was teaching a control the ship did not have. Look, then fly, then
     find the engines, then use them. */
  fetchStep('thrusters','Something is missing',
    'A piece of the ship came down out on the sand'),
  /* ...and only NOW altitude, with the thrusters aboard. */
  { key:'alt', task:'Up and down', hud:{},
    /* SHORT. The long version wrapped to five lines and collided with the
       achievement toast and the PULL button — three things stacked in the same
       band of screen. A hint card is read at a glance while flying; anything
       that needs a paragraph belongs in the reading steps at the end. */
    say:()=>TOUCH?'Slide up or down the middle to change altitude.'
                 :'SHIFT climbs, CTRL dives.',
    begin(s){ s.minY=s.maxY=saucer.position.y; },
    test(s){ const y=saucer.position.y; if(y<s.minY)s.minY=y; if(y>s.maxY)s.maxY=y;
             return s.maxY-s.minY>=22; } },
  /* 4 — OUT OF THE DESERT. The first real journey, and the first sight of
     another land. Nothing to beam out here worth learning on: the sand holds
     vultures, which never touch the ground, and camels, which are a long walk
     apart. The lesson is over there. */
  crossStep('toWild','Leave the desert',WILD,
    'Green country lies that way. Fly to the beacon'),
  /* ...the beam, before there is anything to beam. */
  fetchStep('beam','Pick up the light',
    'Another piece is lying in the grass'),
  { key:'beam', task:'Beam up a creature', joy:{side:'right',anim:'beam'}, hud:{},
    say(s){
      if(S.beamLock>0.03) return 'Locked on — hold it steady!';
      if(S.beamPower>0.12) return 'Beam open — centre it on the creature.';
      return TOUCH?'Over the ▼ sheep — double-tap & HOLD.'
                  :'Over the ▼ sheep — hold SPACE.';
    },
    begin(s){ s.base=S.taken; s.target=null; },
    test(s){ trackMarker(s); return S.taken>s.base; },
    end(){ if(marker)marker.visible=false; } },
  // 6 — CRYSTALS. Beamed up like a creature; what they pay depends on the reactor.
  { key:'crystal', task:'Energy crystals', hud:{},
    say(s){
      const drain=S.energyMode==='drain';
      if(s.got) return 'Got it.';
      return (drain
        ? 'Crystals refuel your reactor. Beam the glowing crystal up.'
        : 'Your reactor is infinite, so crystals pay out in harvest points. Beam it up.');
    },
    begin(s){ s.base=S.crystals; s.got=false; s.obj=ensureCrystal(); },
    test(s){
      if(s.obj&&s.obj.parent)
        markWaypoint(s.obj.position,'#9fe8ff',16);
      else s.obj=null;
      if(S.crystals>s.base)s.got=true;
      return s.got; } },
  // 7 — MASS PULL: the charged special that drags every nearby creature in.
  { key:'pull', task:'Mass pull', hud:{point:'pull'},
    say(s){
      if(Special.active) return 'Holding — everything nearby is being dragged in!';
      if(Special.charge<1) return 'Recharging… it refills as you fly and abduct.';
      return TOUCH?'Hold PULL — it drags every creature nearby to you.'
                  :'Hold Q — it drags every creature nearby to you.';
    },
    begin(s){ s.used=false; Special.charge=1; },   // hand them a full charge to try it
    test(s){ if(Special.active)s.used=true; return s.used; } },
  /* 7 — INTO SETTLED COUNTRY. The second crossing, and the last lesson needs
     what only this land has: people. */
  crossStep('toUrban','Find the towns',URBAN,
    'Roads and rooftops that way. Fly to the beacon'),
  /* Modules are FETCHED, each one at the moment it becomes the thing you need
     next: thrusters while learning to fly, the beam before there is anything to
     beam, the cloak before the first quarry that runs. Earning the tool before
     being taught the trick is the right order — it makes each one a thing the
     player owns rather than a thing they were handed, and it teaches the habit
     the whole run depends on: the ship is incomplete and its pieces are lying
     about in the world. See fetchStep. */
  fetchStep('cloak','Go and get the last one',
    'The last piece is down there among the rooftops'),
  /* AND NOW USE IT, on the one quarry that runs — a few hundred metres away.

     Everything up to here stood still and waited to be taken. A person sees the
     ship and runs for the nearest door, so the trick is to arrive without being
     seen — and that only means anything if there is ground to cross while
     invisible. See trackHuman: the target sits 300-500m from where the cloak
     was picked up.

     No point: here — this step used to pulse the PULL button, a leftover from
     when it followed the pull lesson directly. */
  { key:'cloak', task:'Go quiet', hud:{map:true},
    say(s){
      const d=s.target?Math.round(Math.hypot(saucer.position.x-s.target.position.x,
                                             saucer.position.z-s.target.position.z)):0;
      if(!s.didCloak)
        return (TOUCH?'HOLD the ship itself to go dark':'Press C to go dark')
               +(d?', then fly to the ▼ — '+d+' m.':'.');
      if(!S.cloak)
        return 'Cloak dropped. Go dark again and stay that way while you close in.';
      return d>60?'Invisible. Close on the ▼ — '+d+' m.'
                 :'Invisible. Slide over them and take them before they look up.';
    },
    begin(s){
      s.base=S.taken; s.didCloak=false; s.target=null;
      s.fromX=saucer.position.x; s.fromZ=saucer.position.z;   // where the cloak was collected
    },
    test(s){
      if(S.cloak)s.didCloak=true;
      trackHuman(s);
      return s.didCloak&&S.taken>s.base;
    },
    end(){ if(marker)marker.visible=false; S.cloak=false; } },

  /* 13..17 — the reading steps.

     ONE SHORT SENTENCE EACH. An earlier pass wrote these as atmosphere — "there
     is country that sleeps, and country that watches back" — which reads well
     and teaches nothing. These five are the only steps the player cannot work
     out by doing, so they are the five that must be plain: say the fact, name
     the thing, get out of the way. Atmosphere belongs in the world, not in the
     hint card the player is waiting to dismiss.

     Titles are plain for the same reason: the card shows the title and the line
     together, so an evocative title costs a line of reading before the useful
     one starts. */
  // 13 — the MAP is revealed, once flying is second nature.
  { key:'map', task:'Your map', hud:{map:true,point:'map'},
    say(s){ return 'Bottom-left: you are the arrow, and it marks crystals and '+
                   'ship parts near you.'+CLOCK(s); },
    begin:dwellBegin, test:dwellTest },
  // 14 — the three lands, and what they are worth.
  { key:'biomes', task:'Three lands', hud:{map:true,point:'map'},
    say(s){ return 'Wilderness is the easiest hunting, towns are harder, desert '+
                   'is the hardest.'+CLOCK(s); },
    begin:dwellBegin, test:dwellTest },
  // 15 — the coloured rim that says which land lies where.
  { key:'compass', task:'Map edges', hud:{map:true,point:'map'},
    say(s){ return 'The coloured edges show which land lies which way, and how '+
                   'far.'+CLOCK(s); },
    begin:dwellBegin, test:dwellTest },
  // 16 — the three modules and how the ship reports them.
  { key:'upgrades', task:'Missing parts', hud:{map:true},
    say(s){ return 'Reach for a part you have not found and its grey mark shows '+
                   'above the ship.'+CLOCK(s); },
    begin:dwellBegin, test:dwellTest },
  // 17 — HULL. Saved for last: the hand-off line, the moment training ends.
  { key:'hull', task:'Crashes are real now', hud:{map:true},
    say(s){ return 'Nothing has been able to hurt you so far; after this, hitting '+
                   'anything will.'+CLOCK(s); },
    begin:dwellBegin, test:dwellTest },
];

/* Where the mass-pull lesson sits in the running order. See pullTaught(). */
const PULL_STEP=steps.findIndex(s=>s.key==='pull');

/* ---- controller ----------------------------------------------------------- */
export const Tutorial={
  active:false,
  _i:0,
  _s:null,
  _roam:0,          // seconds the closing banner holds before the choice modal
  _awaiting:false,  // choice modal is up: stop running steps
  /* Set by screens.js (which owns startGame) so the closing modal can restart
     the tutorial or drop the player into Story mode without an import cycle. */
  replayRun:null,
  toMenu:null,

  /* Is the PULL button allowed on screen yet?

     Owning the beam is not enough. The mass pull is the beam used all at once,
     and a player who has never opened the beam on a single sheep has no idea
     what "everything nearby is dragged in" means — the button is a mystery
     control offering a trick for a tool they have not used. So during the
     guided run it stays off screen until its own lesson comes up, which is
     after the sheep. One ordinary abduction, THEN the party trick.

     Outside the tutorial there is no lesson to wait for, so the answer is yes
     and special.js's own S.upHasBeam test is the whole gate. Read from main.js
     rather than imported by special.js, which would close an import cycle. */
  pullTaught(){ return !this.active || this._i>=PULL_STEP; },

  /* Offer the tutorial from the Play button. onYes / onSkip start the game. */
  prompt(onYes,onSkip){
    showModal('Night Harvest Protocol','Play the tutorial?',
      'A quick guided run teaches you to look around, fly, navigate, beam up your '+
      'first catch, and read your HUD. You can skip straight into free play instead.',
      [ {label:'Show me',primary:true,onClick:onYes},
        {label:'Skip',onClick:onSkip} ]);
  },

  /* Begin the walkthrough (the game must already be running). */
  start(){
    build();
    this.active=true; this._awaiting=false; S.tutorial=true;   // suppresses lethal hazards (lightning)
    S.tutorialLesson=true;               // and hides unrelated objective arrows
    this._roam=0;
    this._i=0; this._begin();
    this.hint.classList.add('on');
  },
  get hint(){ return build().hint; },
  _cur(){ return steps[this._i]; },

  _begin(){
    const st=this._cur(); this._s={};
    if(st.begin)st.begin(this._s);
    hud(st.hud||{});                                        // stage the HUD for this step
    showJoyDemo(st.joy&&st.joy.side,st.joy&&st.joy.anim);   // animated stick guide (touch only)
    this._render();
  },
  _render(){
    const d=build(), st=this._cur();
    d.step.textContent='Task '+(this._i+1)+' of '+steps.length;
    d.task.textContent=st.task;
    d.doo.textContent=st.say(this._s);
    d.dots.innerHTML='';
    for(let k=0;k<steps.length;k++){
      const dot=document.createElement('div');
      dot.className='tut-dot'+(k<this._i?' done':k===this._i?' now':'');
      d.dots.appendChild(dot);
    }
  },

  update(dt){
    if(!this.active)return;
    // The closing modal is up and waiting on the player: the lessons are over, so
    // there is no step left to run. Without this the loop would walk off the end
    // of `steps` every frame once _ask() cleared the banner hold.
    if(this._awaiting)return;
    if(S.state!=='playing'){ return; }                 // paused / crashed: leave the card as-is
    // Lessons done — hold on the closing banner, then put the choice up.
    if(this._roam>0){
      this._roam-=dt;
      if(this._roam<=0)this._ask();
      return;
    }
    const st=this._cur();
    if(!st){ this._ask(); return; }                    // belt and braces: never run past the last step
    // refresh the dynamic line (e.g. the beacon distance, a dwell countdown)
    build().doo.textContent=st.say(this._s);
    if(st.test(this._s,dt)){
      if(st.end)st.end(this._s);   // steps that lend state back need it
      this._i++;
      if(this._i>=steps.length){ this._roamPhase(); return; }
      this._begin();
    }
  },

  /* All lessons passed: clear the coaching UI, show the closing banner and put
     the choice up right behind it. */
  _roamPhase(){
    this.hint.classList.remove('on');
    showJoyDemo(null);
    S.tutorialLesson=false;        // free flight — show every objective again
    hud({map:true});                // full HUD, no highlight rings
    banner('TRAINING COMPLETE — THE VALLEY IS YOURS');
    this._roam=BANNER_HOLD;        // just long enough to read the banner
  },

  /* The closing choice, shown right after the final message. */
  _ask(){
    this._roam=0; this._awaiting=true;
    showModal('Training complete','Where to now, pilot?',
      'You have the controls, the beam, the pull and the HUD. Crashes are live from '+
      'here on. Keep exploring this world, run the training again, or head back to '+
      'the main menu.',
      [ {label:'Keep exploring',primary:true,onClick:()=>{ this._awaiting=false; this.active=false; S.tutorial=false; S.tutorialLesson=false; }},
        {label:'Restart tutorial',onClick:()=>{ this._awaiting=false; if(this.replayRun)this.replayRun(); else this.start(); }},
        {label:'Main menu',onClick:()=>{ this._awaiting=false; this.stop(); if(this.toMenu)this.toMenu(); }} ]);
  },

  /* Tear everything down (called by startGame on any fresh run). */
  stop(){
    this.active=false; this._awaiting=false; S.tutorial=false; S.tutorialLesson=false; this._i=0; this._s=null; this._roam=0;
    joySide=null; clearTimeout(joyDimT);
    if(dom){ dom.hint.classList.remove('on'); dom.modal.classList.remove('on'); dom.joy.classList.remove('on'); }
    if(beacon)beacon.visible=false;
    if(marker)marker.visible=false;
    if(tutCrystal){                       // uncollected lesson crystal — take it back
      scene.remove(tutCrystal);
      const i=pickups.indexOf(tutCrystal); if(i>=0)pickups.splice(i,1);
      tutCrystal=null;
    }
    if(tutHuman){                         // ...the lesson bystander, if uncollected
      scene.remove(tutHuman);
      const i=animals.indexOf(tutHuman); if(i>=0)animals.splice(i,1);
      tutHuman=null;
    }
    if(tutSheep){                         // ...and the lesson animal, if it survived
      scene.remove(tutSheep);
      const i=animals.indexOf(tutSheep); if(i>=0)animals.splice(i,1);
      tutSheep=null;
    }
    hudRestore();
  },
};
export default Tutorial;
