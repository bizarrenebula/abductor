/* =========================================================================
   DISTANT BIRDS — a few slow silhouettes crossing the sky, for life and
   composition ("occasional silhouettes crossing the horizon", art brief).
   A small flock of simple two-wing shapes that flap gently, glide on a slow
   heading high above, and recycle around the ship. Dark, cheap, no shadows.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene } from '../core/engine.js';
import { saucer } from './saucer.js';

const COUNT = env.LOW_END ? 4 : 8;
const R = 340, RECYCLE = 460;
const ALT_MIN = 60, ALT_MAX = 120;

const birdMat=new THREE.MeshStandardMaterial({color:0x1b222b,roughness:1,metalness:0,flatShading:true});
const wingGeo=new THREE.BoxGeometry(2.3,0.07,0.66);   // shared across every wing

function buildBird(){
  const g=new THREE.Group();
  const lP=new THREE.Group(), rP=new THREE.Group();
  const lw=new THREE.Mesh(wingGeo,birdMat); lw.position.x=-1.15; lP.add(lw);
  const rw=new THREE.Mesh(wingGeo,birdMat); rw.position.x= 1.15; rP.add(rw);
  g.add(lP); g.add(rP);
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.16,0.9,5),birdMat));   // stubby body
  g.userData={lP,rP};
  return g;
}

export const Birds={
  list:[], data:[],
  init(){
    for(let i=0;i<COUNT;i++){ const g=buildBird(); scene.add(g); this.list.push(g);
      this.data.push({phase:Math.random()*6.28,flap:5+Math.random()*3,
        head:Math.random()*6.28,spd:5+Math.random()*5,scale:1.4+Math.random()*1.6}); }
  },
  placeOne(g,d,px,pz){
    const a=Math.random()*6.28, r=R*0.5+Math.random()*R*0.5;
    g.position.set(px+Math.cos(a)*r, ALT_MIN+Math.random()*(ALT_MAX-ALT_MIN), pz+Math.sin(a)*r);
    d.head=Math.atan2(px-g.position.x, pz-g.position.z)+(Math.random()-0.5)*1.6;   // roughly toward the ship
    g.scale.setScalar(d.scale);
  },
  reset(px,pz){
    if(!this.list.length)this.init();
    for(let i=0;i<COUNT;i++)this.placeOne(this.list[i],this.data[i],px||0,pz||0);
  },
  update(dt){
    if(!this.list.length)return;
    const t=performance.now()*0.001, sx=saucer.position.x, sz=saucer.position.z;
    for(let i=0;i<COUNT;i++){
      const g=this.list[i], d=this.data[i];
      const fx=Math.sin(d.head), fz=Math.cos(d.head);
      g.position.x+=fx*d.spd*dt; g.position.z+=fz*d.spd*dt;
      g.position.y+=Math.sin(t*0.5+d.phase)*dt*1.5;                 // gentle bob
      g.rotation.y=d.head;
      const f=Math.sin(t*d.flap+d.phase)*0.6;                        // flap
      g.userData.lP.rotation.z=-f; g.userData.rP.rotation.z=f;
      if(Math.hypot(g.position.x-sx,g.position.z-sz)>RECYCLE)this.placeOne(g,d,sx,sz);
    }
  }
};
