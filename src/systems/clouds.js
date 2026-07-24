/* =========================================================================
   CLOUDS — soft billowing puff-clouds the saucer can fly above, under or
   straight through. Each cloud is a cluster of sprite "puffs" that spring back
   to their home shape; when the ship pushes into them they billow outward
   (a light physics shove) and then re-form. Clouds drift on the wind and are
   recycled ahead of the ship as it roams, so the sky is always populated.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene } from '../core/engine.js';
import { saucer } from './saucer.js';

const COUNT   = env.LOW_END ? 7 : 13;    // clouds kept around the ship
const PUFFS   = env.LOW_END ? 5 : 8;     // sprites per cloud
const SPAWN_R = 420;                     // spread radius around the ship
const RECYCLE = SPAWN_R + 320;           // beyond this, a cloud is moved ahead
const ALT_MIN = 34, ALT_MAX = 92;        // cloud altitude band (fly under the high ones)
const R_PUSH  = 15;                      // ship within this of a puff shoves it
const SPRING  = 2.4, DAMP = 0.86;

/* one soft round puff */
const puffTex=(function(){
  const N=128,c=document.createElement('canvas');c.width=c.height=N;const x=c.getContext('2d');
  const gr=x.createRadialGradient(64,64,0,64,64,64);
  gr.addColorStop(0,'rgba(255,255,255,0.95)');gr.addColorStop(0.45,'rgba(224,234,244,0.55)');gr.addColorStop(1,'rgba(224,234,244,0)');
  x.fillStyle=gr;x.fillRect(0,0,N,N);
  return new THREE.CanvasTexture(c);
})();

export const Clouds={
  list:[], _v:new THREE.Vector3(),
  build(cx,cz){
    const g=new THREE.Group();
    const cy=ALT_MIN+Math.random()*(ALT_MAX-ALT_MIN);
    const w=20+Math.random()*34, d=12+Math.random()*20;
    const n=PUFFS+((Math.random()*3)|0);
    const puffs=[];
    for(let i=0;i<n;i++){
      const home=new THREE.Vector3((Math.random()-0.5)*w,(Math.random()-0.5)*7,(Math.random()-0.5)*d);
      const m=new THREE.SpriteMaterial({map:puffTex,transparent:true,opacity:0.48+Math.random()*0.22,
        depthWrite:false,color:0xdde6ef});
      const s=new THREE.Sprite(m);const sc=24+Math.random()*22;s.scale.set(sc,sc,1);
      s.position.copy(home);g.add(s);
      puffs.push({s,home,pos:home.clone(),vel:new THREE.Vector3()});
    }
    g.position.set(cx,cy,cz);scene.add(g);
    this.list.push({g,center:new THREE.Vector3(cx,cy,cz),
      drift:new THREE.Vector3((Math.random()-0.5)*1.6,0,(Math.random()-0.5)*1.6),puffs});
  },
  reset(){ for(const c of this.list)scene.remove(c.g); this.list.length=0; },
  spawnField(px,pz){
    this.reset();
    for(let i=0;i<COUNT;i++){
      const a=Math.random()*6.28, r=90+Math.random()*SPAWN_R;
      this.build(px+Math.cos(a)*r, pz+Math.sin(a)*r);
    }
  },
  update(dt){
    if(!this.list.length)return;
    const sx=saucer.position.x, sy=saucer.position.y, sz=saucer.position.z;
    const damp=Math.pow(DAMP,dt*60);
    for(const c of this.list){
      c.center.x+=c.drift.x*dt; c.center.z+=c.drift.z*dt;
      // recycle a far cloud to a fresh spot around the ship
      if(Math.hypot(c.center.x-sx,c.center.z-sz)>RECYCLE){
        const a=Math.random()*6.28, r=SPAWN_R*0.7+Math.random()*160;
        c.center.set(sx+Math.cos(a)*r, ALT_MIN+Math.random()*(ALT_MAX-ALT_MIN), sz+Math.sin(a)*r);
      }
      c.g.position.copy(c.center);
      for(const p of c.puffs){
        // spring toward home (re-forms the cloud)
        this._v.copy(p.home).sub(p.pos);
        p.vel.addScaledVector(this._v, SPRING*dt);
        // shove away from the ship when it flies through
        const dx=c.center.x+p.pos.x-sx, dy=c.center.y+p.pos.y-sy, dz=c.center.z+p.pos.z-sz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<R_PUSH*R_PUSH){
          const d=Math.sqrt(d2)||1, push=(1-d/R_PUSH)*70*dt/d;
          p.vel.x+=dx*push; p.vel.y+=dy*push; p.vel.z+=dz*push;
        }
        p.vel.multiplyScalar(damp);
        p.pos.addScaledVector(p.vel, dt);
        p.s.position.copy(p.pos);
      }
    }
  }
};
