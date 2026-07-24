/* =========================================================================
   PROPS — beam-fodder scenery (cacti, rocks, trees, monoliths, spires). No
   reward; non-human props vanish when pulled up, humans-in-props drop back.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { OBJ_SCALE, ASSETS } from '../core/constants.js';
import { mat, part, measureSolid } from '../core/mesh.js';
import { scene } from '../core/engine.js';

/* =========================================================================
   TWISTED DARK-CARTOON GEOMETRY — procedural gnarled shapes for the Tim-Burton
   world. A trunk built from short tapered segments whose direction bends each
   step (the gnarl), sprouting bare crooked branches + twigs, topped with a
   sparse lopsided near-black canopy, and leaning as a whole. Deliberately
   spindly and exaggerated. Used everywhere so the look is consistent (desktop
   too — we override the realistic tree.glb with this).
   ========================================================================= */
/* ---- baked crooked trees ----------------------------------------------------
   Each tree used to be ~8 separate meshes. Now a handful of varied crooked tree
   shapes are baked ONCE into single merged geometries (trunk + gnarled branches
   + lopsided canopy, vertex-coloured bark/leaf), shared across every tree. A
   tree instance is then a SINGLE flat-shaded mesh with a random spin + lean —
   one draw call, still individually abductable. Variety comes from the baked
   shapes, the per-variant colour jitter, and the per-instance transform, per the
   art brief ("diverse forest from very few assets"). ------------------------- */
const _up=new THREE.Vector3(0,1,0), _q=new THREE.Quaternion(), _c=new THREE.Vector3(),
      _one=new THREE.Vector3(1,1,1), _m=new THREE.Matrix4();

// Merge {geo, matrix, color:[r,g,b]} parts into one non-indexed geometry with a
// colour attribute. No BufferGeometryUtils dependency (not loaded here).
function mergeParts(parts){
  let total=0;
  const baked=parts.map(p=>{ const g=p.geo.toNonIndexed(); g.applyMatrix4(p.matrix);
    total+=g.attributes.position.count; return {g,c:p.color}; });
  const pos=new Float32Array(total*3), nor=new Float32Array(total*3), col=new Float32Array(total*3);
  let o=0;
  for(const {g,c} of baked){
    const P=g.attributes.position, N=g.attributes.normal;
    for(let i=0;i<P.count;i++,o++){
      pos[o*3]=P.getX(i);pos[o*3+1]=P.getY(i);pos[o*3+2]=P.getZ(i);
      nor[o*3]=N.getX(i);nor[o*3+1]=N.getY(i);nor[o*3+2]=N.getZ(i);
      col[o*3]=c[0];col[o*3+1]=c[1];col[o*3+2]=c[2];
    }
    g.dispose();
  }
  const out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.BufferAttribute(pos,3));
  out.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  out.setAttribute('color',new THREE.BufferAttribute(col,3));
  return out;
}
function segMatrix(from,dir,len){ _q.setFromUnitVectors(_up,dir);
  _c.copy(from).addScaledVector(dir,len/2); return _m.compose(_c,_q,_one).clone(); }

function bakeTree(){
  const parts=[];
  const bh=Math.random()*0.03;
  const bark=[0.055+bh,0.038+bh*0.5,0.022];                        // near-black brown, jittered
  const lv=Math.random();
  const leaf=[0.04+lv*0.04,0.105+lv*0.06,0.078+lv*0.025];          // dark green, slightly varied
  const segs=(env.LOW_END?3:4)+((Math.random()*2)|0), RS=env.LOW_END?4:6;
  let r=0.22+Math.random()*0.09;
  const pos=new THREE.Vector3(0,0,0);
  const dir=new THREE.Vector3((Math.random()-0.5)*0.3,1,(Math.random()-0.5)*0.3).normalize();
  for(let i=0;i<segs;i++){
    const h=0.55+Math.random()*0.5, topR=r*0.82;
    parts.push({geo:new THREE.CylinderGeometry(topR,r,h,RS), matrix:segMatrix(pos,dir,h), color:bark});
    pos.addScaledVector(dir,h);
    dir.x+=(Math.random()-0.5)*0.7; dir.z+=(Math.random()-0.5)*0.7; dir.y-=Math.random()*0.12; dir.normalize();
    r=topR;
    if(i>=1 && Math.random()<0.9){                                  // crooked branch
      const bl=0.7+Math.random()*1.1, br=Math.max(0.05,r*0.55);
      const bdir=new THREE.Vector3((Math.random()-0.5)*2.4,0.4+Math.random()*0.9,(Math.random()-0.5)*2.4).normalize();
      const br0=pos.clone();
      parts.push({geo:new THREE.CylinderGeometry(br*0.35,br,bl,Math.max(4,RS-1)), matrix:segMatrix(br0,bdir,bl), color:bark});
      if(!env.LOW_END && Math.random()<0.7){                        // a twig, bent again
        const tl=0.35+Math.random()*0.6, tip=br0.clone().addScaledVector(bdir,bl);
        const tdir=new THREE.Vector3((Math.random()-0.5)*2.6,0.4+Math.random(),(Math.random()-0.5)*2.6).normalize();
        parts.push({geo:new THREE.CylinderGeometry(0.02,br*0.35,tl,4), matrix:segMatrix(tip,tdir,tl), color:bark});
      }
    }
  }
  if(Math.random()<0.72){                                           // sparse lopsided canopy
    const n=1+((Math.random()*3)|0);
    for(let i=0;i<n;i++){
      const cpos=pos.clone().add(new THREE.Vector3((Math.random()-0.5)*1.0,Math.random()*0.4,(Math.random()-0.5)*1.0));
      _q.identity(); parts.push({geo:new THREE.IcosahedronGeometry(0.5+Math.random()*0.5,0),
        matrix:_m.compose(cpos,_q,new THREE.Vector3(1,0.66,1)).clone(), color:leaf});
    }
  }
  return mergeParts(parts);
}

const TREE_N=env.LOW_END?4:6;
const TREE_GEOS=[]; for(let i=0;i<TREE_N;i++)TREE_GEOS.push(bakeTree());
const treeMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0.02,flatShading:true});

export function twistedTree(){
  const m=new THREE.Mesh(TREE_GEOS[(Math.random()*TREE_N)|0], treeMat);
  m.castShadow=!env.LOW_END;
  m.rotation.set(0,Math.random()*6.28,(Math.random()-0.5)*0.36);   // random spin + overall lean
  return m;
}

export function twistedRock(hex){
  const g=new THREE.Group();
  const m=mat(hex,0.96);
  const shards=2+((Math.random()*2)|0);
  for(let i=0;i<shards;i++){
    const r=part(new THREE.TetrahedronGeometry(0.7+Math.random()*0.9,0),m,
      (Math.random()-0.5)*0.7,0.2+Math.random()*0.5,(Math.random()-0.5)*0.7);
    r.scale.set(0.8+Math.random()*0.6,1.2+Math.random()*0.9,0.8+Math.random()*0.6);   // spiky, upthrust
    r.rotation.set(Math.random()*0.6,Math.random()*6.28,(Math.random()-0.5)*0.7);
    g.add(r);
  }
  return g;
}
import { World } from '../world/world-config.js';
import { LOADED, spawnModel } from '../assets.js';
import { props } from './registry.js';
import { chunks } from '../world/chunks.js';
import { saucer } from '../systems/saucer.js';
import { effBeamR } from '../systems/beam.js';
import { beep } from '../audio/music.js';

export function buildProp(biome){
  const g=new THREE.Group();const u=g.userData;
  if(World.name==='earth'){
    if(biome==='desert'){
      const gr=mat(0x3a5636,0.9);
      g.add(part(new THREE.CylinderGeometry(0.3,0.35,2.4,8),gr,0,1.2,0));
      const a1=part(new THREE.CylinderGeometry(0.18,0.2,1.1,8),gr,-0.62,1.6,0);a1.rotation.z=0.5;g.add(a1);
      const a2=part(new THREE.CylinderGeometry(0.16,0.18,0.9,8),gr,0.58,1.2,0);a2.rotation.z=-0.5;g.add(a2);
    }else if(biome==='mountain'){
      g.add(twistedRock(0x54565e));               // jagged, upthrust dark shards
    }else if(biome==='canyon'){
      g.add(twistedRock(0x6a4a3e));               // reddish gorge rock
    }else{
      // twisted dark-cartoon tree — solid: the ship crashes into it (slim =
      // collide with the trunk). Procedural everywhere, so the gnarled look is
      // consistent (we intentionally skip the realistic tree.glb here).
      u.solid=true;u.slim=true;u.sway=Math.random()*6.28;   // gentle wind sway (see updateProps)
      const tt=twistedTree();tt.scale.setScalar(1.5+Math.random()*0.7);g.add(tt);
    }
  }else if(World.name==='moon'){
    if(Math.random()<0.35){
      const mo=part(new THREE.BoxGeometry(0.6,3.2,0.25),mat(0x14161c,0.3),0,1.6,0);
      mo.rotation.y=Math.random()*3;g.add(mo);
    }else{
      const r=part(new THREE.DodecahedronGeometry(1,0),mat(0x4c5054,0.95),0,0.6,0);
      r.scale.setScalar(0.6+Math.random()*0.9);r.rotation.set(Math.random(),Math.random(),Math.random());g.add(r);
    }
  }else{
    if(Math.random()<0.4){
      const sp=part(new THREE.ConeGeometry(0.5,3.4+Math.random()*2,7),mat(0x50221a,0.9),0,1.8,0);g.add(sp);
    }else{
      const r=part(new THREE.DodecahedronGeometry(1,0),mat(0x5a2c1e,0.95),0,0.6,0);
      r.scale.setScalar(0.5+Math.random()*0.9);r.rotation.set(Math.random(),Math.random(),Math.random());g.add(r);
    }
  }
  u.lift=0;u.spin=Math.random()*2-1;g.scale.multiplyScalar(OBJ_SCALE);
  if(u.solid)measureSolid(g);
  return g;
}
export function updateProps(dt,beamActive){
  const R=effBeamR(), now=performance.now()*0.001;
  for(let i=props.length-1;i>=0;i--){
    const p=props[i],u=p.userData;
    // slow wind sway on trees — a barely-there lean that breathes with the wind
    if(u.sway!=null&&u.lift===0&&u.gone==null)
      p.rotation.z=Math.sin(now*0.7+u.sway)*0.03+Math.sin(now*1.9+u.sway)*0.012;
    if(u.gone!=null){
      u.gone-=dt;
      p.scale.multiplyScalar(Math.max(0.0001,1-dt*4));
      p.position.y+=dt*10;p.rotation.y+=dt*9;
      if(u.gone<=0){scene.remove(p);props.splice(i,1);
        for(const [k,c] of chunks){const j=c.props.indexOf(p);if(j>=0){c.props.splice(j,1);break;}}}
      continue;
    }
    const dx=p.position.x-saucer.position.x,dz=p.position.z-saucer.position.z;
    const inBeam=beamActive&&(dx*dx+dz*dz)<R*R;
    if(inBeam){
      u.lift=Math.min(1,u.lift+dt*0.55);
      p.rotation.y+=dt*4*u.spin;
      if(!u.human&&u.lift>0.8){u.gone=0.5;beep(180+Math.random()*120,0.15,0.05);continue;}
    }else if(u.lift>0){
      u.lift=Math.max(0,u.lift-dt*1.9);   // dropped
      if(u.lift===0&&u.human)beep(90,0.12,0.06);
    }
    p.position.y=u.baseY+u.lift*(saucer.position.y-u.baseY-4);
  }
}
