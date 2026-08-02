/* =========================================================================
   WEATHER — a drifting spatial weather field with a beam multiplier, a
   falling-particle system, ambient dust motes, and the HUD region label.
   Weather is a function of WHERE you are, not of a timer, so one region rains
   while the next is sunny (see WEATHER SYSTEMS below). Runtime state (current
   type, sample timer, fog target, biome) lives on the shared `weather` object
   so the main loop and startGame can mutate it across modules.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene, camera } from '../core/engine.js';
import { World } from './world-config.js';
import { nWx, nTemp, nMoist, fbm } from './noise.js';
import { regionWeights, regionAt, REGION_NAME } from './regions.js';
import { banner } from '../ui/banner.js';
import { PARTTEX } from './textures.js';
import { regionV, multV } from '../ui/dom.js';
import { t } from '../i18n.js';

const LOW_END = env.LOW_END;

export const WEATHER={
  clear   :{name:'weather.clear', mult:1.0,  vis:false,fog:0.0062},
  rain    :{name:'weather.rain',        mult:0.75, vis:true, color:0x9fbccf,size:2.2,fall:70,slant:8,fog:0.0072,tex:'rain'},
  sunny   :{name:'weather.sunny',     mult:1.2,  vis:false,fog:0.0044},
  sandstorm:{name:'weather.sandstorm',  mult:0.55, vis:true, color:0xbfa070,size:1.6,fall:14,slant:60,fog:0.0145,tex:'grain'},
  snow    :{name:'weather.snow',     mult:0.65, vis:true, color:0xbcd0dc,size:1.3,fall:9, slant:3, fog:0.0085,tex:'dot'},
  snowstorm:{name:'weather.snowstorm', mult:0.55, vis:true, color:0xd8e4ea,size:1.5,fall:18,slant:34,fog:0.0145,tex:'dot'},
  fog     :{name:'weather.fog',   mult:0.8,  vis:false,fog:0.014},
  vacuum  :{name:'weather.vacuum',      mult:1.1,  vis:false,fog:0.002},
  meteors :{name:'weather.meteors', mult:0.85, vis:true, color:0xcfd8e0,size:1.0,fall:26,slant:20,fog:0.0028,tex:'dot'},
  calm    :{name:'weather.calm',   mult:1.0,  vis:false,fog:0.0055},
  duststorm:{name:'weather.duststorm',  mult:0.6,  vis:true, color:0xb85a28,size:2.1,fall:12,slant:78,fog:0.013,tex:'grain'}
};

/* shared runtime weather state */
export const weather={ cur:'clear', timer:0, fogTarget:0.0062, biome:'plains',
                       pending:null, hold:0, snap:true, labelBiome:null, dwell:0 };

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

/* ---- WEATHER SYSTEMS -------------------------------------------------------
   Weather belongs to the PLACE, not to a timer. A low-frequency field over the
   world decides how unsettled the sky is at each point, so one region rains
   while the next is sunny — and flying out of a storm and back again finds the
   same storm rather than a fresh dice roll. That single property is what makes
   the sky feel like geography instead of a slot machine.

   The field drifts, so fronts do pass over a stationary ship; just on the order
   of ten minutes rather than ten seconds. */
export const WX_SCALE=0.00013;   // ~7700-unit weather systems: minutes to cross one
export const WX_DRIFT=9;         // units/sec the whole field travels (~14 min per system)
const WX_SAMPLE=1.5;             // seconds between samples (the field moves slowly)
const WX_HOLD=5;                 // agreeing samples to commit: 7.5s of steady evidence
const WX_DWELL=18;               // ...and once it changes, it holds at least this long
let wxDrift=0;

/* How unsettled the sky is here: 0 settled and bright, 1 the middle of a front.
   The noise is roughly symmetric about 0 with its 10th/90th percentiles at
   -+0.385, so x1.3 about 0.5 spreads it across the full 0..1 range. */
export function severityAt(x,z){
  // TWO octaves, not the usual three or four. Extra octaves put high-frequency
  // detail on the threshold crossings, which shatters the edge of a front into
  // dozens of slivers — measured as a weather change every ~180 units. A nearly
  // smooth field gives blobby systems with one clean boundary.
  const v=fbm(nWx,(x+wxDrift)*WX_SCALE,(z+wxDrift*0.42)*WX_SCALE,2);
  let s=0.5+v*1.45;
  /* A land has a climate, and the climate scales the front. The wilderness is a
     bright spring country and the desert is brighter still, so the same system
     that sits over a town as rain passes over the meadows as a shower and over
     the sand as nothing much at all. Urban land alone feels the field at full
     strength, which is what makes flying out of the city feel like flying into
     better weather. */
  const W=regionWeights(x,z);
  s*=1-W.wild*0.22-W.des*0.42;
  return s<0?0:s>1?1:s;
}

/* Regional climate — deliberately sampled an order of magnitude below the
   frequency the BIOME uses. Weather must not switch identity because the ship
   crossed a pond or a ridge: a rain system stays a rain system over whatever
   happens to be underneath it. This is the difference between weather that
   belongs to a region and weather that belongs to a texel. */
const CLIM=0.00018;              // ~5500-unit climate zones

/* What the sky over this point wants to be. A pure function of position — no
   randomness anywhere, which is the whole point: leave a storm, come back, and
   the storm is still there. */
export function weatherAt(x,z){
  if(World.name==='moon')return 'vacuum';          // airless: no weather at all
  const sev=severityAt(x,z);
  if(World.name==='mars')return sev>0.55?'duststorm':'calm';
  // One octave: the climate decides a system's IDENTITY, and identity should not
  // wobble mid-storm. Extra octaves here made a front flip rain/sandstorm/rain.
  const temp =fbm(nTemp ,(x+900)*CLIM,(z-900)*CLIM,1);
  const moist=fbm(nMoist,(x-500)*CLIM,(z+500)*CLIM,1);
  /* Identity comes from the LAND first and the climate second. Sand blows where
     there is sand to blow; snow falls on cold country, but never on a
     wilderness that is meant to read as spring — there it comes down as a
     shower instead. */
  const W=regionWeights(x,z);
  const des=W.des>0.5, wild=W.wild>0.5;
  if(sev>0.74){                                    // a front is over this region
    if(des)return 'sandstorm';
    if(!wild&&temp<-0.16)return 'snowstorm';       // cold region: it comes down as snow
    return 'rain';
  }
  if(sev>0.54){
    if(des)return 'clear';                         // the desert's worst is a hot haze
    if(!wild&&temp<-0.16)return 'snow';
    if(moist>0.14)return 'fog';                    // damp region, settling air
    return 'clear';
  }
  return sev<0.28?'sunny':'clear';
}

/* Called every frame from the main loop. Samples on a slow cadence and only
   commits a change once the new system has agreed with itself for a few
   samples, so skimming along a boundary never flickers the sky. */
export function tickWeather(dt,x,z,biome){
  if(World.name==='earth')watchRegion(x,z);
  wxDrift+=dt*WX_DRIFT;
  if(biome!==weather.labelBiome){ weather.labelBiome=biome; refreshRegion(); }
  weather.dwell+=dt;
  weather.timer-=dt;
  if(weather.timer>0)return;
  weather.timer=WX_SAMPLE;
  const want=weatherAt(x,z);
  if(want===weather.cur){ weather.pending=null; weather.hold=0; return; }
  if(weather.snap){                      // first sample of a run: no easing in
    weather.snap=false; weather.pending=null; weather.hold=0;
    applyWeather(want); weather.dwell=0; return;
  }
  // Clipping the corner of a system must not change the sky. Two guards: the
  // new weather has to agree with itself for WX_HOLD samples, and whatever is
  // showing has to have been up for WX_DWELL. Without the second one, threading
  // between two fronts still produced six-second bursts of snow.
  if(weather.dwell<WX_DWELL)return;
  if(want===weather.pending){
    if(++weather.hold>=WX_HOLD){
      applyWeather(want); weather.pending=null; weather.hold=0; weather.dwell=0;
    }
  }else{ weather.pending=want; weather.hold=1; }
}

/* Start a run: drop the drift so a fresh world is not mid-front, and take the
   next sample immediately rather than debouncing into the right sky. */
export function resetWeatherField(){
  wxDrift=0;
  weather.timer=0; weather.pending=null; weather.hold=0;
  weather.snap=true; weather.labelBiome=null; weather.dwell=WX_DWELL;
  resetRegionWatch();
}
/* ---- crossing into a new land ------------------------------------------
   The player is never told which land they started in — the desert around the
   Area 51 sign is the opening image and naming it would explain the joke. What
   IS announced is every crossing after that, so the three regions are learned
   by travelling rather than by reading a label that is always on screen.

   Committed on WEIGHT, not on the dominant label: the weight rises smoothly
   through the border blend, so requiring 0.62 means skimming along a boundary
   cannot flap the banner, and there is no timer to tune. */
let lastRegion=-1;
export function resetRegionWatch(){ lastRegion=-1; }
function watchRegion(x,z){
  const W=regionWeights(x,z);
  const w=[W.wild,W.des,W.urb];
  const rg=regionAt(x,z);
  if(rg===lastRegion||w[rg]<0.62)return;
  if(lastRegion>=0)banner(t('land.'+REGION_NAME[rg]));   // silent on the first sample
  lastRegion=rg;
}

export function curBiomeLabel(){
  if(World.name==='moon')return t('region.mare');
  if(World.name==='mars')return t('region.redwaste');
  return t({plains:'region.grassland',desert:'region.desert',mountain:'region.highlands',water:'region.wetland'}[weather.biome]||'region.wilds');
}
export function applyWeather(w){
  weather.cur=w;const W=WEATHER[w];
  weather.fogTarget=W.fog||0.0062;
  if(W.vis){precip.visible=true;pMat.color.setHex(W.color);pMat.size=W.size;
    pMat.map=PARTTEX[W.tex]||null;pMat.needsUpdate=true;
    precip.userData={fall:W.fall,slant:W.slant};}
  else precip.visible=false;
  refreshRegion();
  setBeamMultHUD(W.mult);
}
/* The HUD's "<region> · <weather>" line. Biome and weather now change
   independently, so either one refreshes it. */
export function refreshRegion(){
  // Weather only. The land you are in is announced when you cross into it (see
  // watchRegion) rather than sitting permanently in the corner of the HUD.
  regionV.textContent=t(WEATHER[weather.cur].name);
}
/* The `beam ±%` readout. Altitude now moves it too, so the main loop refreshes
   this every frame with weather × altitude rather than only on weather change. */
export function setBeamMultHUD(m){
  const pct=Math.round((m-1)*100);
  multV.textContent=t('hud.beamMult')+' '+(pct>=0?'+':'')+pct+'%';
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
