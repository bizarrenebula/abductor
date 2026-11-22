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
import { GLTF } from '../core/three.js';
import { scene, camera } from '../core/engine.js';

const hand=new THREE.Group();     // placed in camera space
const wrist=new THREE.Group();
hand.add(wrist);

/* ---- built in CENTIMETRES, from real hand proportions ----
   palm 8.4 wide at the knuckles, 9.6 long, 2.8 thick; middle finger 8.2,
   index 7.4, ring 7.7, little 6.0; phalanges in a 47 : 29 : 24 ratio. The
   model group scales it into view space (about twice life size, held past the
   near plane — reads the same as a real hand held close). */
const CM=0.0235;
const model=new THREE.Group(); model.scale.setScalar(CM); wrist.add(model);

/* ---- skin ----
   Linear pre-images, as everywhere in this codebase (three r128 does not
   convert a hex handed to a material): ~#d9a184 skin, ~#f0c8b8 nails.

   Two things carry most of the realism. A fine procedural pore/crease bump map
   so the surface is not plastic at this distance, and a warm translucent RIM —
   skin lets red light through at grazing angles (subsurface scattering), which
   is why a backlit hand glows orange at its edges. Faked with a fresnel term
   added to the emissive, which also keeps the hand readable at night. */
function skinTex(){
  const N=256, c=document.createElement('canvas'); c.width=c.height=N; const x=c.getContext('2d');
  const img=x.createImageData(N,N), d=img.data;
  for(let i=0;i<N*N;i++){
    const px=i%N, py=(i/N)|0;
    // pores: fine noise; creases: faint horizontal bands (knuckle wrinkles)
    let v=128+(Math.random()-0.5)*70;
    v+=Math.sin(py*0.55+Math.sin(px*0.05)*3)*10;
    d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255;
  }
  x.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(3,3); return t;
}
const BUMP=skinTex();
function skinMat(color,rim){
  const m=new THREE.MeshStandardMaterial({color,roughness:0.58,metalness:0,
    bumpMap:BUMP,bumpScale:0.035,emissive:0x0d0503,emissiveIntensity:1});
  m.onBeforeCompile=sh=>{
    sh.uniforms.uRim={value:new THREE.Color(rim)};
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>','#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        float fr=1.0-abs(dot(normalize(normal),normalize(vViewPosition)));
        totalEmissiveRadiance+=uRim*pow(fr,2.6);`);
  };
  return m;
}
const skin=skinMat(0xb15b3b,0x5a1206);
const skinTip=skinMat(0xb5553a,0x6a1408);          // fingertips and knuckles run a touch redder
const nail=new THREE.MeshStandardMaterial({color:0xd6907a,roughness:0.22,metalness:0,
  emissive:0x140806,emissiveIntensity:1});

/* A phalanx: a tapered capsule lathed from a profile, so it is smooth and its
   rounded ends overlap the next joint with no gap. Flattened front-to-back,
   because fingers are wider than they are deep. Runs from y=0 up to y=len. */
function phalanx(r0,r1,len,tip){
  const pts=[], N=6;
  for(let i=0;i<=N;i++){ const a=-Math.PI/2+i/N*Math.PI/2; pts.push(new THREE.Vector2(Math.cos(a)*r0, Math.sin(a)*r0)); }
  for(let i=1;i<=6;i++){ const k=i/6; pts.push(new THREE.Vector2(r0+(r1-r0)*k, len*k)); }
  const capR=tip?r1*1.05:r1;
  for(let i=1;i<=N;i++){ const a=i/N*Math.PI/2; pts.push(new THREE.Vector2(Math.cos(a)*capR, len+Math.sin(a)*capR*(tip?1.25:1))); }
  pts[pts.length-1].x=0.0001;
  const g=new THREE.LatheGeometry(pts,18);
  g.scale(1,1,0.84);
  return g;
}
/* A smooth rounded box: a sphere pushed out toward a box (a superellipsoid).
   Unlike a bevelled BoxGeometry it has continuous normals — no seams. */
function roundedBlob(hx,hy,hz,ex,ey,ez,ws=28,hs=20){
  const g=new THREE.SphereGeometry(1,ws,hs), p=g.attributes.position;
  const f=(v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e);
  for(let i=0;i<p.count;i++)p.setXYZ(i,f(p.getX(i),ex)*hx,f(p.getY(i),ey)*hy,f(p.getZ(i),ez)*hz);
  return g;
}

/* where the domed back of the palm is, at a given x (see the palm build) */
const backZ=x=>1.45+0.35*Math.cos(Math.min(1,Math.abs(x)/4.2)*Math.PI*0.5);
const fingers=[];
/* x: knuckle position across the palm; y: knuckle height (the arc of the
   knuckle line — middle highest, little lowest); len, r: length and base radius. */
function finger(x,y,len,r,splay){
  const a=len*0.47, b=len*0.29, c=len*0.24;
  const j0=new THREE.Group(); j0.position.set(x,y,0.1); model.add(j0);
  j0.add(new THREE.Mesh(phalanx(r,r*0.9,a),skin));
  const j1=new THREE.Group(); j1.position.y=a; j0.add(j1);
  j1.add(new THREE.Mesh(phalanx(r*0.9,r*0.82,b),skin));
  const j2=new THREE.Group(); j2.position.y=b; j1.add(j2);
  j2.add(new THREE.Mesh(phalanx(r*0.82,r*0.76,c*0.8,true),skinTip));
  // the nail: a shallow curved shell on the back of the last joint, slightly
  // proud of the skin, ending just short of the tip
  const nw=r*0.78, nl=c*0.62;
  const ng=new THREE.SphereGeometry(1,14,8,0,Math.PI*2,0,Math.PI*0.36);
  ng.rotateX(Math.PI/2); ng.scale(nw,nl,0.32*r); ng.translate(0,0,-0.32*r*0.9);
  const n=new THREE.Mesh(ng,nail); n.position.set(0,c*0.47,r*0.76*0.84+0.02); n.rotation.x=-0.06; j2.add(n);
  // the knuckle: the metacarpal head showing through the back of the hand
  const kn=new THREE.Mesh(roundedBlob(r*0.95,r*0.9,r*0.55,0.8,0.8,0.8,12,10),skinTip);
  kn.position.set(x,y-0.7,backZ(x)-0.18); model.add(kn);
  // the extensor tendon running back from it toward the wrist, barely raised
  const td=new THREE.Mesh(roundedBlob(0.28,3.6,0.22,0.9,0.7,0.9,8,10),skin);
  td.position.set(x*0.7,y-4.4,backZ(x*0.7)-0.12); td.rotation.z=x*0.04; model.add(td);
  fingers.push({j0,j1,j2,splay});
}
let thumb;
(function(){
  // palm: a rounded slab, narrower at the wrist, domed on the back, cupped in front
  const pg=roundedBlob(4.2,4.9,1.45,0.32,0.3,0.6,32,24), pp=pg.attributes.position;
  for(let i=0;i<pp.count;i++){
    let x=pp.getX(i), y=pp.getY(i), z=pp.getZ(i);
    const ky=(y+4.9)/9.8;                                     // 0 at the wrist, 1 at the knuckles
    x*=0.86+0.14*ky;
    if(z>0)z+=Math.cos(x/4.2*Math.PI*0.5)*0.35;               // the back of the hand domes
    else z+=Math.cos(x/4.2*Math.PI*0.5)*Math.sin(ky*Math.PI)*0.45;   // the palm cups
    pp.setXYZ(i,x,y,z);
  }
  pg.computeVertexNormals();
  const palm=new THREE.Mesh(pg,skin); palm.position.y=0.2; model.add(palm);
  // thenar eminence: the fleshy pad at the base of the thumb
  const th=new THREE.Mesh(roundedBlob(2.0,3.0,1.5,0.8,0.8,0.8,16,12),skin);
  th.position.set(-2.6,-2.2,-0.35); th.rotation.z=0.35; model.add(th);
  // hypothenar: the outer edge of the palm, below the little finger
  const hy=new THREE.Mesh(roundedBlob(1.3,3.2,1.25,0.8,0.8,0.8,14,12),skin);
  hy.position.set(3.1,-1.2,-0.2); model.add(hy);

  // wrist and forearm, running down and back toward you out of view
  const arm=new THREE.Group(); arm.position.set(0,-4.4,0.1); arm.rotation.x=-0.42; model.add(arm);
  const ap=[[2.9,0],[3.05,-2],[3.25,-6],[3.6,-14],[3.9,-26]].map(v=>new THREE.Vector2(v[0],v[1]));
  const ag=new THREE.LatheGeometry(ap,22); ag.scale(1.12,1,0.78);
  arm.add(new THREE.Mesh(ag,skin));
  const cloth=new THREE.MeshStandardMaterial({color:0x0a0f14,roughness:0.95,emissive:0x020304,emissiveIntensity:1});
  const sl=new THREE.Mesh(new THREE.CylinderGeometry(4.6,5.2,24,20,1,true),cloth);
  sl.scale.set(1.1,1,0.85); sl.position.y=-21; arm.add(sl);
  const cuff=new THREE.Mesh(new THREE.TorusGeometry(4.6,0.55,8,24),cloth);
  cuff.rotation.x=Math.PI/2; cuff.scale.set(1.1,0.85,1); cuff.position.y=-9; arm.add(cuff);

  // index → little, left to right as seen from behind a right hand
  finger(-2.9,4.55,7.4,0.95,-0.09);
  finger(-0.95,4.95,8.2,1.0,-0.03);
  finger( 0.95,4.75,7.7,0.93, 0.03);
  finger( 2.85,4.05,6.0,0.8, 0.11);

  // thumb: hinged low on the palm (the CMC joint), its metacarpal hidden in the
  // thenar pad, then two phalanges. An inner group turns it so its nail faces
  // sideways and back, as a real thumb's does.
  thumb=new THREE.Group(); thumb.position.set(-3.2,-3.4,-0.2); model.add(thumb);
  const ti=new THREE.Group(); ti.rotation.y=-1.0; thumb.add(ti);
  ti.add(new THREE.Mesh(phalanx(1.35,1.2,4.2),skin));
  const t0=new THREE.Group(); t0.position.y=4.2; t0.rotation.x=-0.25; ti.add(t0);
  t0.add(new THREE.Mesh(phalanx(1.18,1.08,3.1),skin));
  const t1=new THREE.Group(); t1.position.y=3.1; t0.add(t1);
  t1.add(new THREE.Mesh(phalanx(1.08,1.0,2.3,true),skinTip));
  const tng=new THREE.SphereGeometry(1,14,8,0,Math.PI*2,0,Math.PI*0.36);
  tng.rotateX(Math.PI/2); tng.scale(0.85,1.45,0.38); tng.translate(0,0,-0.34);
  const tn=new THREE.Mesh(tng,nail); tn.position.set(0,1.45,0.93); tn.rotation.x=-0.06; t1.add(tn);
  thumb.userData.t1=t1;
})();
model.traverse(o=>{ if(o.isMesh){ o.castShadow=false; o.receiveShadow=false; } });

/* ---- the real hand: models/hand.glb ----
   Generated, rigged and exported by scripts/gen-hand.py — one continuous
   skinned surface (smooth-blended anatomy, polygonised), 21 bones, nails as
   their own plates. The primitive hand above is only the fallback until it
   arrives (or if it cannot load); once it does, the rig below drives its bones
   with the same mudra poses.

   Loaded on every device, unlike the optional scenery models: it is the one
   model the player looks at the whole time. */
let rig=null;     // {fingers:[{j0,j1,j2,splay}], thumb:[b1,b2,b3], bindQ}
/* Skin for a skinned mesh. Vertex colours carry the flush of the knuckles and
   fingertips; the shader adds fine pores (a noise bump in bind-pose space, so
   they stay put on the skin as it bends) and the warm subsurface rim. */
function glbSkin(){
  /* The emissive is a warm floor so the hand never goes moonlight-grey: the
     night here is blue, and skin under it reads as a corpse without it. */
  const m=new THREE.MeshStandardMaterial({color:0xc46842,roughness:0.52,metalness:0,
    vertexColors:true,skinning:true,emissive:0x2c0f06,emissiveIntensity:1});
  m.onBeforeCompile=sh=>{
    sh.uniforms.uRim={value:new THREE.Color(0x9a2c10)};
    sh.vertexShader=sh.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvBind=position;');
    sh.fragmentShader=sh.fragmentShader
      .replace('#include <common>',`#include <common>
        uniform vec3 uRim; varying vec3 vBind;
        float hh(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
        float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        { vec3 q=vBind*7.0; float e=0.35, n0=vn(q);
          vec3 g=vec3(vn(q+vec3(e,0,0))-n0, vn(q+vec3(0,e,0))-n0, vn(q+vec3(0,0,e))-n0);
          normal=normalize(normal-g*0.22); }`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        float fr=1.0-abs(dot(normalize(normal),normalize(vViewPosition)));
        totalEmissiveRadiance+=uRim*pow(fr,2.4);`);
  };
  return m;
}
if(GLTF)GLTF.load('models/hand.glb',g=>{
  /* r128's loader turns the two primitives (skin, nails) into two skinned
     meshes sharing one skeleton — dress each by its material's name. */
  const sks=[];
  g.scene.traverse(o=>{ if(o.isSkinnedMesh)sks.push(o); });
  if(!sks.length)return;
  const sk=sks[0];
  const bones={}; sk.skeleton.bones.forEach(b=>bones[b.name]=b);
  const skinM=glbSkin();
  const nailM=new THREE.MeshStandardMaterial({color:0xe0a090,roughness:0.18,metalness:0,
    vertexColors:true,skinning:true,emissive:0x2e1610,emissiveIntensity:1});
  for(const m of sks)m.material=(m.material&&m.material.name==='nail')?nailM:skinM;
  g.scene.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.renderOrder=5; o.castShadow=o.receiveShadow=false; } });
  // swap the primitive hand out for the real one, in the same cm-space group
  for(const c of [...model.children])c.visible=false;
  model.add(g.scene);
  // a dark sleeve over the forearm
  const cloth=new THREE.MeshStandardMaterial({color:0x0a0f14,roughness:0.95,emissive:0x020304,emissiveIntensity:1});
  const sl=new THREE.Mesh(new THREE.CylinderGeometry(3.7,4.3,16,24,1,true),cloth);
  sl.scale.set(1,1,0.82); sl.position.y=-16.5; sl.frustumCulled=false; sl.renderOrder=5; model.add(sl);
  const cf=new THREE.Mesh(new THREE.TorusGeometry(3.7,0.45,10,28),cloth);
  cf.rotation.x=Math.PI/2; cf.scale.set(1,0.82,1); cf.position.y=-8.6; cf.frustumCulled=false; cf.renderOrder=5; model.add(cf);
  const F=['index','middle','ring','little'];
  rig={
    fingers:F.map((n,i)=>({j0:bones[n+'1'],j1:bones[n+'2'],j2:bones[n+'3'],splay:[-0.09,-0.03,0.03,0.1][i]})),
    thumb:[bones.thumb1,bones.thumb2,bones.thumb3],
    bindQ:bones.thumb1.quaternion.clone(),
  };
},undefined,()=>{ /* keep the primitive hand */ });

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
const _te=new THREE.Euler(), _tq=new THREE.Quaternion();
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
  if(rig){
    /* The model's bind pose already has the natural splay, so spread is
       applied relative to it: 1 = as modelled, 0 = fingers together. */
    for(let i=0;i<4;i++){
      const f=rig.fingers[i], c=cur.curl[i];
      f.j0.rotation.set(-c*1.45+tremble(i),0,f.splay*(cur.spread-1)*1.2);
      f.j1.rotation.x=-c*1.65;
      f.j2.rotation.x=-c*1.15;
    }
    /* Thumb bones: local Y runs along the thumb, Z out of its nail. Flexing
       across the palm is about local X; swinging away from the fingers is
       about local Z. Composed onto the bind rotation of the first bone. */
    _te.set(-cur.tIn*0.75, 0, (cur.tOut-0.8)*0.7);
    _tq.setFromEuler(_te);
    rig.thumb[0].quaternion.copy(rig.bindQ).multiply(_tq);
    rig.thumb[1].rotation.x=-cur.tBend*0.5-cur.tIn*0.35;
    rig.thumb[2].rotation.x=-cur.tBend*1.0-cur.tIn*0.2;
  }else{
    for(let i=0;i<4;i++){
      const f=fingers[i], c=cur.curl[i];
      f.j0.rotation.set(-c*1.5+tremble(i),0,f.splay*cur.spread);
      f.j1.rotation.x=-c*1.7;
      f.j2.rotation.x=-c*1.2;
    }
    // thumb: out to the side, or across the palm front toward the fingertips
    thumb.rotation.set(-cur.tIn*0.9, -cur.tIn*0.5, 0.3+cur.tOut*0.9-cur.tIn*1.1);
    thumb.userData.t1.rotation.x=-cur.tBend*1.1;
  }
  glow.material.opacity=Math.min(1,cur.glow);
  const sc=0.3+cur.glow*0.4;
  glow.scale.set(sc,sc,1);
}
export function handEmitPos(out){ return emit.getWorldPosition(out); }
export function showHand(on){ hand.visible=!!on; }
