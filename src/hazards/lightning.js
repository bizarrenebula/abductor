/* =========================================================================
   EARTH LIGHTNING STORMS — telegraphed strikes during rain. A marker crackles,
   then a jagged bolt drops with a screen flash; a direct hit (uncloaked) is fatal.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { World } from '../world/world-config.js';
import { heightAt } from '../world/terrain.js';
import { weather } from '../world/weather.js';
import { saucer } from '../systems/saucer.js';
import { beep } from '../audio/music.js';
import { sfxThunderWarn, sfxLightningStrike, BeamSFX } from '../audio/sfx.js';
import { banner } from '../ui/banner.js';
import { hazMult, hazCount } from './common.js';

const strikes=[];
let lightningTimer=6;
export let flashAmt=0;                       // full-screen flash 0..1
function buildBolt(x,gy,z,topY){
  // jagged vertical bolt from cloud height to ground, built as a thick line ribbon
  const g=new THREE.Group();g.position.set(x,0,z);
  const pts=[];let cx=0,cz=0,y=topY;
  const steps=14;
  for(let i=0;i<=steps;i++){
    pts.push(new THREE.Vector3(cx,y,cz));
    y-=(topY-gy)/steps;
    cx+=(Math.random()-0.5)*3.2;cz+=(Math.random()-0.5)*3.2;
  }
  pts.push(new THREE.Vector3(0,gy,0));
  const geo=new THREE.BufferGeometry().setFromPoints(pts);
  const core=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:1}));
  g.add(core);
  // glow tube-ish: a few offset fainter copies
  for(let j=0;j<2;j++){
    const gl=new THREE.Line(geo.clone(),new THREE.LineBasicMaterial({color:0xbcd8ff,transparent:true,opacity:0.4}));
    gl.position.x=(j?0.5:-0.5);g.add(gl);
  }
  // branch forks
  for(let b=0;b<3;b++){
    const si=3+((Math.random()*8)|0);
    const bp=[pts[si].clone()];let bx=pts[si].x,by=pts[si].y,bz=pts[si].z;
    for(let i=0;i<4;i++){bx+=(Math.random()-0.5)*4;by-=Math.random()*6;bz+=(Math.random()-0.5)*4;bp.push(new THREE.Vector3(bx,by,bz));}
    const bg=new THREE.BufferGeometry().setFromPoints(bp);
    g.add(new THREE.Line(bg,new THREE.LineBasicMaterial({color:0xdcecff,transparent:true,opacity:0.7})));
  }
  return g;
}
function makeStrikeMarker(){
  // ground glow + rising static telegraph before the bolt
  const g=new THREE.Group();
  const ring=new THREE.Mesh(new THREE.RingGeometry(1.4,1.8,28),
    new THREE.MeshBasicMaterial({color:0xbfe0ff,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=0.1;g.add(ring);
  const glow=new THREE.Mesh(new THREE.CircleGeometry(1.6,20),
    new THREE.MeshBasicMaterial({color:0x9fd0ff,transparent:true,opacity:0.3,depthWrite:false}));
  glow.rotation.x=-Math.PI/2;glow.position.y=0.06;g.add(glow);
  g.userData.ring=ring;g.userData.glow=glow;return g;
}
function spawnStrike(bullseye){
  if(S.state!=='playing'||World.name!=='earth')return;
  const lead=1.0;
  const ax=saucer.position.x+S.vel.x*lead, az=saucer.position.z+S.vel.z*lead;
  const spread=bullseye?(Math.random()*3):(8+Math.random()*16);
  const a=Math.random()*Math.PI*2;
  const x=ax+Math.cos(a)*spread, z=az+Math.sin(a)*spread;
  const gy=heightAt(x,z);
  const grp=new THREE.Group();grp.position.set(x,gy+0.1,z);
  const marker=makeStrikeMarker();grp.add(marker);
  scene.add(grp);
  strikes.push({grp,marker,bolt:null,x,z,gy,t:0,phase:'warn',warnDur:1.1});
}
export function clearStrikes(){for(let i=strikes.length-1;i>=0;i--){scene.remove(strikes[i].grp);strikes.splice(i,1);}flashAmt=0;}
export function resetLightning(){clearStrikes();lightningTimer=6;}
export function updateLightning(dt){
  if(World.name!=='earth'){if(strikes.length)clearStrikes();return;}
  // only storms bring lightning
  const storming=(weather.cur==='rain');
  if(storming){
    lightningTimer-=dt;
    if(lightningTimer<=0){
      lightningTimer=(16+Math.random()*14)/hazMult();
      banner('⚡ LIGHTNING STORM — TAKE COVER!');
      sfxThunderWarn();
      const n=hazCount();
      const hitIdx=(Math.random()*n)|0;
      for(let k=0;k<n;k++)setTimeout(()=>spawnStrike(k===hitIdx),k*300);
    }
  }
  if(flashAmt>0)flashAmt=Math.max(0,flashAmt-dt*3.2);
  const t=performance.now()*0.001;
  for(let i=strikes.length-1;i>=0;i--){
    const s=strikes[i];s.t+=dt;
    if(s.phase==='warn'){
      const k=s.t/s.warnDur;
      const mk=s.marker.userData;
      mk.ring.material.opacity=0.4+0.5*Math.abs(Math.sin(t*16));   // fast crackle
      mk.ring.scale.setScalar(1.4-0.4*k);
      mk.glow.material.opacity=0.2+0.4*k;
      if(s.t>=s.warnDur){
        s.phase='strike';s.t=0;
        s.bolt=buildBolt(0,s.gy,0,120);s.grp.add(s.bolt);
        flashAmt=1;                                   // white flash
        // thunder crack
        sfxLightningStrike();
        // lethal at the strike point
        if(S.state==='playing'&&!S.cloak){
          const d=Math.hypot(saucer.position.x-s.x,saucer.position.z-s.z);
          if(d<4.5){S.crashReason='lightning';S.state='crashing';S.vy=-5;
            BeamSFX.stop();S.prevBeam=false;beep(60,1.0,0.18);}
        }
      }
    }else if(s.phase==='strike'){
      // bolt flickers then fades fast
      if(s.bolt){const fl=(s.t<0.4)?(Math.random()>0.4?1:0.2):(1-Math.min(1,(s.t-0.4)/0.35));
        s.bolt.traverse(o=>{if(o.material)o.material.opacity=Math.max(0,o.material.opacity*0+fl);});}
      if(s.marker){s.marker.userData.ring.material.opacity=Math.max(0,0.6*(1-s.t*2));
        s.marker.userData.glow.material.opacity=Math.max(0,0.5*(1-s.t*2));}
      if(s.t>0.75){scene.remove(s.grp);strikes.splice(i,1);}
    }
  }
}
