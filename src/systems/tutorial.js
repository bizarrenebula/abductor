/* =========================================================================
   TUTORIAL — an optional, short guided intro played in the real open world.
   Offered on Play; if taken, it walks the player through four tasks (move,
   change altitude, navigate to a beacon, beam up a creature) with on-screen
   hints, then offers Continue or Replay. Entirely self-contained: it builds its
   own DOM (a start prompt, a HUD hint card, a done panel) and a world beacon,
   so nothing else in the UI needs to know about it.

   Wiring: screens.js calls Tutorial.prompt() from the Play button; main.js
   calls Tutorial.update(dt) each playing frame; startGame() calls Tutorial.stop().
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { saucer } from './saucer.js';
import { TOUCH_ONLY } from '../core/env.js';
import { heightAt } from '../world/terrain.js';

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
  .tut-dots{margin-top:8px;display:flex;gap:6px;justify-content:center}
  .tut-dot{width:22px;height:4px;border-radius:2px;background:rgba(143,232,184,.22)}
  .tut-dot.done{background:rgba(143,232,184,.9)}
  .tut-dot.now{background:rgba(143,232,184,.55)}
  `;
  document.head.appendChild(css);

  const hint=document.createElement('div');hint.id='tutHint';
  hint.innerHTML='<div class="tut-step"></div><div class="tut-task"></div><div class="tut-do"></div><div class="tut-dots"></div>';
  document.body.appendChild(hint);

  const modal=document.createElement('div');modal.className='tut-modal';
  modal.innerHTML='<div class="tut-card"><div class="tut-eyebrow"></div><div class="tut-title"></div><div class="tut-body"></div><div class="tut-row"></div></div>';
  document.body.appendChild(modal);

  dom={
    hint, modal,
    step:hint.querySelector('.tut-step'), task:hint.querySelector('.tut-task'),
    doo:hint.querySelector('.tut-do'), dots:hint.querySelector('.tut-dots'),
    eyebrow:modal.querySelector('.tut-eyebrow'), title:modal.querySelector('.tut-title'),
    body:modal.querySelector('.tut-body'), row:modal.querySelector('.tut-row'),
  };
  return dom;
}
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

/* ---- world beacon (the navigation target) --------------------------------- */
let beacon=null;
function makeBeacon(){
  if(beacon)return beacon;
  const g=new THREE.Group();
  const col=new THREE.Mesh(new THREE.CylinderGeometry(2.4,3.4,190,16,1,true),
    new THREE.MeshBasicMaterial({color:0x6cf0c4,transparent:true,opacity:0.5,
      blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  col.position.y=95; g.add(col);
  const core=new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,190,10),
    new THREE.MeshBasicMaterial({color:0xd6fff0,transparent:true,opacity:0.85,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  core.position.y=95; g.add(core);
  g.visible=false; scene.add(g); beacon=g; return g;
}
function placeBeacon(x,z){
  const b=makeBeacon();
  b.position.set(x,heightAt(x,z),z); b.visible=true;
}

/* ---- the tutorial steps --------------------------------------------------- */
const _p=new THREE.Vector3();
const steps=[
  { key:'move', task:'Take the controls',
    say:()=>TOUCH?'Drag the RIGHT stick to fly. Explore a little.'
                 :'Fly with W A S D. Explore a little.',
    begin(s){ s.acc=0; s.last=saucer.position.clone(); },
    test(s){ s.acc+=Math.hypot(saucer.position.x-s.last.x,saucer.position.z-s.last.z);
             s.last.copy(saucer.position); return s.acc>=55; } },
  { key:'alt', task:'Change altitude',
    say:()=>TOUCH?'Pull the LEFT stick up to climb, down to dive.'
                 :'Hold SHIFT to climb, CTRL to dive.',
    begin(s){ s.minY=s.maxY=saucer.position.y; },
    test(s){ const y=saucer.position.y; if(y<s.minY)s.minY=y; if(y>s.maxY)s.maxY=y;
             return s.maxY-s.minY>=22; } },
  { key:'nav', task:'Navigate the world',
    say(s){ const d=Math.round(Math.hypot(saucer.position.x-beacon.position.x,saucer.position.z-beacon.position.z));
            return 'Fly to the glowing beacon — '+d+' m away.'; },
    begin(s){ const a=S.yaw+0.9, dx=Math.sin(a)*150, dz=Math.cos(a)*150;
              placeBeacon(saucer.position.x+dx,saucer.position.z+dz); },
    test(s){ return Math.hypot(saucer.position.x-beacon.position.x,saucer.position.z-beacon.position.z)<24; },
    end(){ if(beacon)beacon.visible=false; } },
  { key:'beam', task:'Beam up a creature',
    say:()=>TOUCH?'Hover over an animal, then double-tap & HOLD to open the beam.'
                 :'Hover over an animal, then hold SPACE to open the beam.',
    begin(s){ s.base=S.taken; },
    test(s){ return S.taken>s.base; } },
];

/* ---- controller ----------------------------------------------------------- */
export const Tutorial={
  active:false,
  _i:0,
  _s:null,

  /* Offer the tutorial from the Play button. onYes / onSkip start the game. */
  prompt(onYes,onSkip){
    showModal('Night Harvest Protocol','Play the tutorial?',
      'A quick guided run teaches you to fly, change altitude, navigate and beam '+
      'up your first catch. You can skip straight into free play instead.',
      [ {label:'Show me',primary:true,onClick:onYes},
        {label:'Skip',onClick:onSkip} ]);
  },

  /* Begin the walkthrough (the game must already be running). */
  start(){
    build();
    this.active=true; this._i=0; this._begin();
    this.hint.classList.add('on');
  },
  get hint(){ return build().hint; },

  _begin(){
    const st=steps[this._i]; this._s={};
    if(st.begin)st.begin(this._s);
    this._render();
  },
  _render(){
    const d=build(), st=steps[this._i];
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
    if(S.state!=='playing'){ return; }                 // paused / crashed: leave the card as-is
    const st=steps[this._i];
    // refresh the dynamic line (e.g. the beacon distance)
    build().doo.textContent=st.say(this._s);
    if(st.test(this._s)){
      if(st.end)st.end();
      this._i++;
      if(this._i>=steps.length){ this._finish(); return; }
      this._begin();
    }
  },

  _finish(){
    this.hint.classList.remove('on');
    showModal('Training complete','Nicely done, pilot','You can keep flying this '+
      'world, or run the tutorial again.',
      [ {label:'Continue',primary:true,onClick:()=>{ this.active=false; }},
        {label:'Replay',onClick:()=>{ this.start(); }} ]);
  },

  /* Tear everything down (called by startGame on any fresh run). */
  stop(){
    this.active=false; this._i=0; this._s=null;
    if(dom){ dom.hint.classList.remove('on'); dom.modal.classList.remove('on'); }
    if(beacon)beacon.visible=false;
  },
};
export default Tutorial;
