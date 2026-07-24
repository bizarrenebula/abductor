/* =========================================================================
   FIREFLIES — slow drifting motes of warm light that populate the night, for
   atmosphere. One THREE.Points object (a single draw call), recycled around the
   ship; each mote gently bobs and twinkles. Only visible at night; fades out
   through dawn. Cheap: ~60 points, additive, no shadows.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { saucer } from './saucer.js';
import { heightAt } from '../world/terrain.js';

const COUNT = env.LOW_END ? 26 : 60;
const R = 130, RECYCLE = 175;

const dotTex=(function(){
  const N=64,c=document.createElement('canvas');c.width=c.height=N;const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.4,'rgba(255,240,200,0.5)');g.addColorStop(1,'rgba(255,240,200,0)');
  x.fillStyle=g;x.fillRect(0,0,N,N);
  return new THREE.CanvasTexture(c);
})();

export const Fireflies={
  pts:null, data:[],
  init(){
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(COUNT*3),3));
    geo.setAttribute('color',   new THREE.BufferAttribute(new Float32Array(COUNT*3),3));
    const m=new THREE.PointsMaterial({size:2.7,map:dotTex,vertexColors:true,transparent:true,
      depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true,opacity:1,fog:true});
    this.pts=new THREE.Points(geo,m);this.pts.frustumCulled=false;this.pts.renderOrder=2;scene.add(this.pts);
    this.data=[];
    for(let i=0;i<COUNT;i++)this.data.push({phase:Math.random()*6.28,spd:0.5+Math.random()*0.9,
      vx:(Math.random()-0.5)*1.1,vz:(Math.random()-0.5)*1.1});
  },
  reset(px,pz){
    if(!this.pts)this.init();
    const pos=this.pts.geometry.attributes.position.array;
    for(let i=0;i<COUNT;i++){
      const a=Math.random()*6.28, r=Math.random()*R;
      const x=(px||0)+Math.cos(a)*r, z=(pz||0)+Math.sin(a)*r;
      pos[i*3]=x; pos[i*3+1]=heightAt(x,z)+2+Math.random()*11; pos[i*3+2]=z;
    }
    this.pts.geometry.attributes.position.needsUpdate=true;
  },
  update(dt){
    if(!this.pts)return;
    const night=1-S.dayF;
    this.pts.material.opacity=night;
    if(night<0.03){this.pts.visible=false;return;}
    this.pts.visible=true;
    const t=performance.now()*0.001, sx=saucer.position.x, sz=saucer.position.z;
    const pos=this.pts.geometry.attributes.position.array;
    const col=this.pts.geometry.attributes.color.array;
    for(let i=0;i<COUNT;i++){
      const d=this.data[i];
      let x=pos[i*3]+d.vx*dt, y=pos[i*3+1]+Math.sin(t*d.spd+d.phase)*dt*2.2, z=pos[i*3+2]+d.vz*dt;
      if(Math.hypot(x-sx,z-sz)>RECYCLE){
        const a=Math.random()*6.28, r=Math.random()*R*0.85;
        x=sx+Math.cos(a)*r; z=sz+Math.sin(a)*r; y=heightAt(x,z)+2+Math.random()*11;
      }
      pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;
      const tw=0.3+0.7*Math.max(0,Math.sin(t*d.spd*1.7+d.phase));   // twinkle
      col[i*3]=1.0*tw; col[i*3+1]=0.85*tw; col[i*3+2]=0.42*tw;      // warm amber
    }
    this.pts.geometry.attributes.position.needsUpdate=true;
    this.pts.geometry.attributes.color.needsUpdate=true;
  }
};
