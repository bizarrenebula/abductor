/* =========================================================================
   THE HAND — the wanderer has no gun. The pulse comes out of their own palm,
   and the hand speaks in MUDRAS: every state of the pulse has a shape.

     relaxed   at rest, ready
     ABHAYA    "fear not" — open palm thrust forward, fingers together: the shot
     GYAN      thumb to index, the other fingers long: gathering, recharging
     FIST      the cell is empty
     PRANA     ring and little finger to the thumb: a crystal taken in (brief)
     STRAIN    fingers splayed and trembling: a saucer's beam has you
     LOWERED   inside a shelter, hand down and quiet

   A right hand in the lower right of the view, back toward you, fingers up.
   Poses are blended, never snapped, so the hand flows from one shape to the
   next. Built at about twice life size and pushed past the camera's 0.5 near
   plane, which looks the same as a life-size hand held close.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene, camera } from '../core/engine.js';

const hand=new THREE.Group();     // placed in camera space
const wrist=new THREE.Group();
hand.add(wrist);

/* Skin a little warm-emissive so it still reads at night. Linear pre-images,
   as everywhere in this codebase (three r128 does not convert a hex handed to
   a material): these land on ~#c98f6a skin and ~#e8c0a8 nails. */
const skin=new THREE.MeshStandardMaterial({color:0x954625,roughness:0.75,metalness:0,
  emissive:0x200a04,emissiveIntensity:0.8});
const nail=new THREE.MeshStandardMaterial({color:0xce8664,roughness:0.4,emissive:0x1a0a06,emissiveIntensity:0.6});
const seg=(r0,r1,len)=>{ const g=new THREE.CylinderGeometry(r1,r0,len,8); g.translate(0,len/2,0); return g; };
const knuckle=r=>new THREE.SphereGeometry(r,8,6);

/* A finger: three segments, each pivoting at its joint. Curl bends all three
   toward the palm (−Z); spread swings the whole finger sideways. */
const fingers=[];
function finger(x,len,splay){
  const a=len*0.45, b=len*0.3, c=len*0.25, r=0.025;
  const j0=new THREE.Group(); j0.position.set(x,0.115,0); wrist.add(j0);
  j0.add(new THREE.Mesh(knuckle(r*1.05),skin));
  j0.add(new THREE.Mesh(seg(r,r*0.95,a),skin));
  const j1=new THREE.Group(); j1.position.y=a; j0.add(j1);
  j1.add(new THREE.Mesh(knuckle(r*0.95),skin));
  j1.add(new THREE.Mesh(seg(r*0.95,r*0.88,b),skin));
  const j2=new THREE.Group(); j2.position.y=b; j1.add(j2);
  j2.add(new THREE.Mesh(knuckle(r*0.88),skin));
  j2.add(new THREE.Mesh(seg(r*0.88,r*0.8,c),skin));
  const n=new THREE.Mesh(new THREE.BoxGeometry(0.03,c*0.6,0.008),nail); n.position.set(0,c*0.55,0.021); j2.add(n);
  fingers.push({j0,j1,j2,splay});
}
let thumb;
(function(){
  const palm=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.23,0.065),skin); palm.position.y=0.005; wrist.add(palm);
  const heel=new THREE.Mesh(new THREE.SphereGeometry(0.1,12,8),skin); heel.scale.set(1,0.55,0.35); heel.position.y=-0.1; wrist.add(heel);
  const sleeve=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.095,0.6,10),
    new THREE.MeshStandardMaterial({color:0x070b10,roughness:0.9,emissive:0x020406,emissiveIntensity:0.6}));
  sleeve.position.set(0,-0.4,0.08); sleeve.rotation.x=-0.25; wrist.add(sleeve);
  // index → little, left to right as seen from behind a right hand
  finger(-0.072,0.21,-0.09);
  finger(-0.024,0.23,-0.03);
  finger( 0.024,0.22, 0.03);
  finger( 0.07,0.18, 0.10);
  // thumb: a base that swings out (z) and across the palm (x/y), two segments
  thumb=new THREE.Group(); thumb.position.set(-0.095,-0.06,-0.01); wrist.add(thumb);
  thumb.add(new THREE.Mesh(knuckle(0.034),skin));
  thumb.add(new THREE.Mesh(seg(0.034,0.03,0.1),skin));
  const t1=new THREE.Group(); t1.position.y=0.1; thumb.add(t1);
  t1.add(new THREE.Mesh(knuckle(0.03),skin));
  t1.add(new THREE.Mesh(seg(0.03,0.026,0.08),skin));
  thumb.userData.t1=t1;
})();

/* The glow in the palm, and the point the pulse leaves from. */
function glowTex(){
  const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(150,255,230,0.7)'); g.addColorStop(1,'rgba(80,220,255,0)');
  x.fillStyle=g; x.fillRect(0,0,64,64);
  const tx=new THREE.CanvasTexture(c); tx.encoding=THREE.sRGBEncoding; return tx;
}
const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex(),color:0x9fffe8,transparent:true,opacity:0.5,
  blending:THREE.AdditiveBlending,depthWrite:false}));
glow.position.set(0,0.03,-0.07); glow.scale.set(0.42,0.42,1); wrist.add(glow);
const emit=new THREE.Object3D(); emit.position.set(0,0.03,-0.12); wrist.add(emit);

hand.traverse(o=>{ if(o.isMesh||o.isSprite){ o.frustumCulled=false; o.renderOrder=5; } });
hand.visible=false;
camera.add(hand);
if(!camera.parent)scene.add(camera);      // camera children only render when the camera is in the scene

/* ---- the mudras ----
   curl[i]: 0 straight .. 1 closed, per finger (index, middle, ring, little).
   spread: multiplier on each finger's natural splay.
   tOut: thumb swung away from the palm (1) or tucked to it (0).
   tIn:  thumb brought across the front of the palm (0..1).
   tBend: thumb tip bend.  glow: palm light.
   at: where the hand is held — x,y,z and its tilt. */
const POSES={
  relaxed:{curl:[0.22,0.28,0.34,0.4], spread:1,   tOut:0.8, tIn:0,   tBend:0.2, glow:0.5,
           at:{x:0.46,y:-0.5,z:-1.25,rx:-0.35,ry:0.15,rz:0.22}},
  abhaya: {curl:[0,0,0,0],            spread:0.25,tOut:0.45,tIn:0,   tBend:0,   glow:1.4,
           at:{x:0.2,y:-0.24,z:-1.55,rx:-0.02,ry:0.02,rz:0.04}},
  gyan:   {curl:[0.62,0.06,0.1,0.14], spread:1.4, tOut:0.35,tIn:0.75,tBend:0.35,glow:0.18,
           at:{x:0.42,y:-0.46,z:-1.3,rx:-0.22,ry:0.3,rz:0.3}},
  fist:   {curl:[1,1,1,1],            spread:0.2, tOut:0.2, tIn:0.85,tBend:0.6, glow:0.04,
           at:{x:0.44,y:-0.56,z:-1.25,rx:-0.45,ry:0.1,rz:0.15}},
  prana:  {curl:[0,0,0.78,0.82],      spread:0.8, tOut:0.3, tIn:0.8, tBend:0.4, glow:1.1,
           at:{x:0.36,y:-0.4,z:-1.35,rx:-0.15,ry:0.2,rz:0.2}},
  strain: {curl:[0.1,0.05,0.1,0.15],  spread:2.6, tOut:1.1, tIn:0,   tBend:0,   glow:0.3,
           at:{x:0.3,y:-0.34,z:-1.3,rx:0.15,ry:0.05,rz:0.1}},
  lowered:{curl:[0.4,0.45,0.5,0.55],  spread:0.8, tOut:0.6, tIn:0.1, tBend:0.3, glow:0.08,
           at:{x:0.5,y:-0.85,z:-1.2,rx:-0.6,ry:0.2,rz:0.3}},
};
/* the live, blended pose */
const cur=JSON.parse(JSON.stringify(POSES.relaxed));
function blend(tgt,k){
  for(let i=0;i<4;i++)cur.curl[i]+=(tgt.curl[i]-cur.curl[i])*k;
  for(const f of ['spread','tOut','tIn','tBend','glow'])cur[f]+=(tgt[f]-cur[f])*k;
  for(const f in tgt.at)cur.at[f]+=(tgt.at[f]-cur.at[f])*k;
}

let pranaT=0;
export function handPrana(){ pranaT=0.7; }      // called when a crystal is taken

/* s: {kick 0..1 (1 on the shot), ready, empty, beamed 0..1, inside, bob, bobA} */
export function updateHand(dt,s){
  pranaT=Math.max(0,pranaT-dt);
  let name='relaxed';
  if(s.inside)name='lowered';
  else if(s.beamed>0.05)name='strain';
  else if(s.kick>0.25)name='abhaya';
  else if(pranaT>0)name='prana';
  else if(s.empty)name='fist';
  else if(!s.ready)name='gyan';
  // the thrust snaps out fast; everything else flows
  const rate=name==='abhaya'?22:9;
  blend(POSES[name],Math.min(1,dt*rate));

  const tr=s.beamed>0.05?s.beamed:0, now=performance.now();
  const tremble=(k)=>tr*0.05*Math.sin(now*0.05+k*1.7);
  const sx=Math.sin(s.bob)*0.25*s.bobA, sy=Math.abs(Math.cos(s.bob))*0.2*s.bobA;
  const a=cur.at;
  /* Sideways offsets are relative to the HORIZONTAL field of view, which is
     narrow on a phone held upright: pull the hand in toward the middle there,
     or it hangs off the right edge behind the FIRE button. */
  const ax=Math.min(1,Math.max(0.38,camera.aspect/1.78));
  hand.position.set((a.x+sx)*ax+tremble(9)*0.3, a.y-sy+tremble(4)*0.3, a.z);
  hand.scale.setScalar(camera.aspect<1?0.8:1);
  hand.rotation.set(a.rx+tremble(1), a.ry, a.rz+tremble(2));
  for(let i=0;i<4;i++){
    const f=fingers[i], c=cur.curl[i];
    f.j0.rotation.set(-c*1.5+tremble(i),0,f.splay*cur.spread);
    f.j1.rotation.x=-c*1.7;
    f.j2.rotation.x=-c*1.2;
  }
  // thumb: out to the side, or across the palm front toward the fingertips
  thumb.rotation.set(-cur.tIn*0.9, -cur.tIn*0.5, 0.3+cur.tOut*0.9-cur.tIn*1.1);
  thumb.userData.t1.rotation.x=-cur.tBend*1.1;
  glow.material.opacity=Math.min(1,cur.glow);
  const sc=0.3+cur.glow*0.4;
  glow.scale.set(sc,sc,1);
}
export function handEmitPos(out){ return emit.getWorldPosition(out); }
export function showHand(on){ hand.visible=!!on; }
