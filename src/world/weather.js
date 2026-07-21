/* =========================================================================
   WEATHER — per-biome/world weather with a beam multiplier, falling-particle
   system, ambient dust motes, and the HUD region label. Runtime weather state
   (current type, timer, fog target, biome) lives on the shared `weather`
   object so the main loop and startGame can mutate it across modules.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene, camera } from '../core/engine.js';
import { World } from './world-config.js';
import { sample } from './terrain.js';
import { PARTTEX } from './textures.js';
import { regionV, multV } from '../ui/dom.js';

const LOW_END = env.LOW_END;

export const WEATHER={
  clear   :{name:'Clear skies', mult:1.0,  vis:false,fog:0.0062},
  rain    :{name:'Rain',        mult:0.75, vis:true, color:0x9fbccf,size:2.2,fall:70,slant:8,fog:0.0072,tex:'rain'},
  sunny   :{name:'Moonlit',     mult:1.2,  vis:false,fog:0.0044},
  sandstorm:{name:'Sandstorm',  mult:0.55, vis:true, color:0xbfa070,size:1.6,fall:14,slant:60,fog:0.0145,tex:'grain'},
  snow    :{name:'Snowfall',    mult:0.65, vis:true, color:0xbcd0dc,size:1.3,fall:9, slant:3, fog:0.0085,tex:'dot'},
  snowstorm:{name:'Snow storm', mult:0.55, vis:true, color:0xd8e4ea,size:1.5,fall:18,slant:34,fog:0.0145,tex:'dot'},
  fog     :{name:'Dense fog',   mult:0.8,  vis:false,fog:0.014},
  vacuum  :{name:'Vacuum',      mult:1.1,  vis:false,fog:0.002},
  meteors :{name:'Meteor dust', mult:0.85, vis:true, color:0xcfd8e0,size:1.0,fall:26,slant:20,fog:0.0028,tex:'dot'},
  calm    :{name:'Still air',   mult:1.0,  vis:false,fog:0.0055},
  duststorm:{name:'Dust storm', mult:0.6,  vis:true, color:0xc46a3a,size:1.8,fall:10,slant:70,fog:0.011,tex:'grain'}
};

/* shared runtime weather state */
export const weather={ cur:'clear', timer:0, fogTarget:0.0062, biome:'plains' };

const PCOUNT=1400;
const pGeo=new THREE.BufferGeometry();
const pPos=new Float32Array(PCOUNT*3);
for(let i=0;i<PCOUNT;i++){pPos[i*3]=(Math.random()-0.5)*160;pPos[i*3+1]=Math.random()*90;pPos[i*3+2]=(Math.random()-0.5)*160;}
pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
const pMat=new THREE.PointsMaterial({color:0xffffff,size:0.7,transparent:true,opacity:0.55,depthWrite:false});
const precip=new THREE.Points(pGeo,pMat);precip.visible=false;scene.add(precip);

/* ambient dust motes (always present, for Inside/Limbo haze) */
const DCOUNT=420;
const dGeo=new THREE.BufferGeometry();
const dPos=new Float32Array(DCOUNT*3);
for(let i=0;i<DCOUNT;i++){dPos[i*3]=(Math.random()-0.5)*130;dPos[i*3+1]=Math.random()*70;dPos[i*3+2]=(Math.random()-0.5)*130;}
dGeo.setAttribute('position',new THREE.BufferAttribute(dPos,3));
const dust=new THREE.Points(dGeo,new THREE.PointsMaterial({color:0x9fb8c6,size:0.32,transparent:true,opacity:0.16,depthWrite:false}));
scene.add(dust);
export function updateDust(){
  const arr=dGeo.attributes.position.array;
  const cx=camera.position.x,cy=camera.position.y,cz=camera.position.z,tt=performance.now()*0.001;
  for(let i=0;i<DCOUNT;i++){
    arr[i*3]+=Math.sin(tt*0.3+i)*0.012; arr[i*3+1]+=Math.cos(tt*0.22+i)*0.008;
    if(Math.abs(arr[i*3]-cx)>75||Math.abs(arr[i*3+2]-cz)>75||Math.abs(arr[i*3+1]-cy)>55){
      arr[i*3]=cx+(Math.random()-0.5)*130;arr[i*3+1]=cy-25+Math.random()*70;arr[i*3+2]=cz+(Math.random()-0.5)*130;
    }
  }
  dGeo.attributes.position.needsUpdate=true;
}

export function pickWeather(biome){
  weather.timer=8+Math.random()*10;
  if(World.name==='moon')return Math.random()<0.3?'meteors':'vacuum';
  if(World.name==='mars')return Math.random()<0.45?'duststorm':'calm';
  if(biome==='desert') return Math.random()<0.35?'sandstorm':'sunny';
  if(biome==='mountain') return Math.random()<0.5?'snowstorm':'snow';
  if(biome==='water') return 'fog';
  return Math.random()<0.3?'rain':'clear';
}
export function curBiomeLabel(){if(World.name==='moon')return 'Mare Umbra';if(World.name==='mars')return 'Red Waste';return {plains:'Grassland',desert:'Desert',mountain:'Highlands',water:'Wetland'}[weather.biome]||'Wilds';}
export function applyWeather(w){
  weather.cur=w;const W=WEATHER[w];
  weather.fogTarget=W.fog||0.0062;
  if(W.vis){precip.visible=true;pMat.color.setHex(W.color);pMat.size=W.size;
    pMat.map=PARTTEX[W.tex]||null;pMat.needsUpdate=true;
    precip.userData={fall:W.fall,slant:W.slant};}
  else precip.visible=false;
  const disp=W.name;
  regionV.textContent=(curBiomeLabel()+' · '+disp);
  const m=W.mult;
  multV.textContent=(m>=1?'beam +':'beam ')+Math.round((m-1)*100)+'%';
  multV.className='mult '+(m>=1?'up':'down');
}
export function updateWeatherParticles(dt){
  if(!precip.visible)return;
  const f=precip.userData.fall,sl=precip.userData.slant;
  const arr=pGeo.attributes.position.array;
  const cx=camera.position.x,cz=camera.position.z,cy=camera.position.y;
  for(let i=0;i<PCOUNT;i++){
    arr[i*3+1]-=f*dt;
    arr[i*3]+=sl*dt*0.3;
    if(arr[i*3+1]<cy-40||Math.abs(arr[i*3]-cx)>90){
      arr[i*3]=cx+(Math.random()-0.5)*150;
      arr[i*3+1]=cy+30+Math.random()*30;
      arr[i*3+2]=cz+(Math.random()-0.5)*150;
    }
  }
  pGeo.attributes.position.needsUpdate=true;
}
