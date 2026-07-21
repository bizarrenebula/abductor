/* =========================================================================
   PROPS — beam-fodder scenery (cacti, rocks, trees, monoliths, spires). No
   reward; non-human props vanish when pulled up, humans-in-props drop back.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, ASSETS } from '../core/constants.js';
import { mat, part } from '../core/mesh.js';
import { scene } from '../core/engine.js';
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
      const r=part(new THREE.DodecahedronGeometry(1,0),mat(0x5c5c60,0.95),0,0.7,0);
      r.scale.set(1.2,0.8,1);r.rotation.set(Math.random(),Math.random(),Math.random());g.add(r);
    }else{
      // tree
      if(LOADED.tree){
        const tm=spawnModel('tree');tm.scale.setScalar((ASSETS.tree.scale||1)*(0.85+Math.random()*0.5));
        tm.rotation.y=Math.random()*6.28;g.add(tm);
      }else{
        g.add(part(new THREE.CylinderGeometry(0.18,0.26,1.6,8),mat(0x3b2c1e,0.95),0,0.8,0));
        g.add(part(new THREE.ConeGeometry(1.2,2.2,9),mat(0x1e3020,0.95),0,2.4,0));
        g.add(part(new THREE.ConeGeometry(0.9,1.6,9),mat(0x243826,0.95),0,3.4,0));
      }
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
  return g;
}
export function updateProps(dt,beamActive){
  const R=effBeamR();
  for(let i=props.length-1;i>=0;i--){
    const p=props[i],u=p.userData;
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
