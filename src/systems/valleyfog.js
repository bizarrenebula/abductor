/* =========================================================================
   VALLEY FOG — low-lying banks of mist that pool in the valleys and along the
   water, for depth and mystery. The scene fog is uniform; this adds the sense
   of fog GATHERING in low ground. A small pool of big soft sprites, placed only
   where the terrain is low, drifting slowly and recycled around the ship.
   Cheap: one texture, ~16 sprites, no shadows. Thickens at night.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { WATER_Y } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { saucer } from './saucer.js';
import { heightAt } from '../world/terrain.js';

const COUNT   = env.LOW_END ? 8 : 18;
const R       = 260, RECYCLE = 330;
const LOW     = WATER_Y + 10;         // only pool where the ground sits below this
const BASE_OP = 0.22;

const fogTex=(function(){
  const N=128,c=document.createElement('canvas');c.width=c.height=N;const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(200,216,230,0.85)');g.addColorStop(0.5,'rgba(180,200,220,0.4)');g.addColorStop(1,'rgba(180,200,220,0)');
  x.fillStyle=g;x.fillRect(0,0,N,N);
  return new THREE.CanvasTexture(c);
})();

// place a bank at a low spot near (px,pz); returns false if the terrain there
// isn't low enough (so it only ever pools in valleys / by water)
function placeLow(o,px,pz){
  for(let tries=0;tries<8;tries++){
    const a=Math.random()*6.28, r=60+Math.random()*R;
    const x=px+Math.cos(a)*r, z=pz+Math.sin(a)*r, g=heightAt(x,z);
    if(g<LOW){ o.position.set(x, Math.max(WATER_Y,g)+3.5+Math.random()*5, z); return true; }
  }
  o.position.set(px,-999,pz); return false;    // parked out of sight this cycle
}

export const ValleyFog={
  list:[], drift:[],
  init(){
    for(let i=0;i<COUNT;i++){
      const m=new THREE.SpriteMaterial({map:fogTex,transparent:true,opacity:0,depthWrite:false,
        color:0xaec2d4,fog:true});
      const s=new THREE.Sprite(m);const sc=64+Math.random()*54;s.scale.set(sc,sc*0.52,1);
      s.renderOrder=-1;scene.add(s);
      this.list.push(s);this.drift.push({vx:(Math.random()-0.5)*1.0,vz:(Math.random()-0.5)*1.0,op:BASE_OP*(0.6+Math.random()*0.8),ph:Math.random()*6.28});
    }
  },
  reset(px,pz){
    if(!this.list.length)this.init();
    for(let i=0;i<COUNT;i++)placeLow(this.list[i],px||0,pz||0);
  },
  update(dt){
    if(!this.list.length)return;
    const t=performance.now()*0.001, sx=saucer.position.x, sz=saucer.position.z;
    const nightBoost=0.6+0.7*(1-S.dayF);          // thicker at night
    for(let i=0;i<COUNT;i++){
      const s=this.list[i], d=this.drift[i];
      s.position.x+=d.vx*dt; s.position.z+=d.vz*dt;
      if(Math.hypot(s.position.x-sx,s.position.z-sz)>RECYCLE)placeLow(s,sx,sz);
      // gentle breathing opacity; sink toward invisible on a bad (non-low) parking
      const vis = s.position.y<-900 ? 0 : d.op*nightBoost*(0.7+0.3*Math.sin(t*0.4+d.ph));
      s.material.opacity=vis;
    }
  }
};
