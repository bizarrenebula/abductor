/* =========================================================================
   WORLD CONFIG — the active world holder, per-world palette/config, sky
   generation, world switching, and the day/night lighting cycle.

   `WORLD` used to be a reassigned global; it is now World.name so other
   modules (startGame, the world picker) can switch worlds by writing to it.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { lerp } from '../core/math.js';
import { scene, renderer, hemi, sun, stars, moon } from '../core/engine.js';
import { S } from '../core/state.js';
import { water } from './water.js';
import { banner } from '../ui/banner.js';
import { t } from '../i18n.js';

export const World = { name:'earth' };   // the active world
let worldHemiBase=0.42;

/* day/night: S.dayF is a smoothed 0..1 (0 night, 1 day); isDay is the discrete phase

   EVERY RUN STARTS AT NIGHT. A saucer is lowered out of a mothership under
   cover of darkness — that is the premise, the arrival film is lit for it, and
   the game's whole palette (lit windows, street lamps, the beam as the brightest
   thing on screen) is built around the dark. Daybreak is something that happens
   TO you a few minutes in, not the state you begin in. */
export function dayNightUpdate(dt){
  const DAY_CYCLE=240;                                   // fixed day/night cycle length (s), independent of any time limit
  const cyc=DAY_CYCLE;
  const phase=Math.floor(S.elapsed/cyc);
  const wantDay=(phase%2===1);                            // first half = NIGHT, then alternate
  if(wantDay!==S.isDay){
    S.isDay=wantDay;
    banner(t(wantDay?'banner.daybreak':'banner.nightfall'));
  }
  S.dayF=lerp(S.dayF,wantDay?1:0,Math.min(1,dt*0.6));     // smooth transition
}
const _dayHemi=new THREE.Color(), _nightHemi=new THREE.Color();
export function applyDayNightLight(){
  const f=S.dayF;                                   // 0 night, 1 day
  const wc=WORLD_CFG[World.name];
  // ambient: kept low in Cinematic so shadows stay deep and mysterious (the
  // drama comes from the directional key against dark fill, not a flat flood)
  // night floor pulled down so the world past the ship's light pool reads as dark
  // (the day value is unchanged: 0.42+1.38 == the old 0.62+1.18 at f=1).
  hemi.intensity=worldHemiBase*(env.usePost?1.02:1.48)*(0.42+1.10*f);
  // warm sky fill by day; keep the world's cool night tint
  if(wc){_nightHemi.setHex(wc.hemi[0]);_dayHemi.setHex(World.name==='mars'?0xcaa080:0xbfd4e0);
    hemi.color.copy(_nightHemi).lerp(_dayHemi,f);}
  // the sun itself is the daytime story: warm, directional, strong-but-not-blinding
  const baseSun=(wc?wc.sun[1]:0.7);
  sun.intensity=baseSun*(0.35+1.05*f);
  sun.color.setRGB(lerp(0.62,1.0,f),lerp(0.75,0.95,f),lerp(1.0,0.82,f));  // cool moonlight → warm sun
  // gentle exposure lift only — avoids the "brightness maxed" look
  /* Day is deliberately NOT a full stop brighter than night. This is a night
     game that happens to have a daytime; a blown-out noon washes the ground
     colours flat and leaves the beam — the brightest thing on screen by design —
     with nothing to be brighter than. Pulled from 0.24 to 0.15. */
  renderer.toneMappingExposure=(env.usePost?1.08:1.18)*(0.84+0.15*f);
  // FOG = the sky's horizon colour (wc.fog matches sky[2]) so distant terrain
  // dissolves seamlessly into the sky — no hard chunk edge, a soft fog-of-war
  // reveal as you move. Only a slight lift by day. Density eases with the light.
  // Deep, near-black fog so the unrevealed distance reads as darkness the ship
  // gently uncovers — not a lit grey haze that washes the whole scene out. The
  // world tint is kept faint and only barely lifted by day.
  if(wc){
    paintSky(wc,f);                 // the sky itself turns with the cycle
    /* Fog has to end up where the sky ends up. It is lerped to fogDay — the day
       gradient's horizon stop — so distant terrain dissolves INTO the sky at
       both ends of the cycle rather than being silhouetted against a bright one. */
    const nf=wc.fog, df=wc.fogDay!=null?wc.fogDay:wc.fog;
    _a.setHex(nf).multiplyScalar(0.42);
    _b.setHex(df);
    scene.fog.color.copy(_a).lerp(_b,f);
  }
  scene.fog.density=lerp(env.LOW_END?0.0050:0.0026, env.LOW_END?0.0040:0.0019, f);
  // stars fade out by day, moon fades in by night
  if(stars)stars.material.opacity=(wc?wc.stars:0.7)*(1-f);
  if(moon)moon.material.opacity=0.9*(1-f)+0.15;
}
/* Each world carries TWO sky gradients — `sky` at midnight, `skyDay` at noon —
   and the background is repainted between them as the cycle turns. `fogDay` is
   the day gradient's horizon stop: the fog has to land on the same colour the
   sky ends on, or distant terrain dissolves into a hard line against a bright
   sky instead of into the sky itself.

   The Moon's two palettes are deliberately identical. It has no atmosphere, so
   its sky is black whether or not the sun is up — the ground lights, the stars
   stay out, and that reads as exactly the airless place it is. */
export const WORLD_CFG={
  earth:{sky:['#010203','#040a0d','#0a1416'],skyDay:['#0c2643','#27506f','#6d8fa4'],
    fog:0x0a1416,fogDay:0x6d8fa4,hemi:[0x264a5a,0.42],sun:[0x8fb2c8,0.7],
    water:true,stars:0.7,moonTint:0xffffff,label:'Earth'},
  moon:{sky:['#000000','#010203','#040608'],skyDay:['#000000','#010203','#060a10'],
    fog:0x040608,fogDay:0x090e14,hemi:[0x40454e,0.35],sun:[0xdfe8f4,0.95],
    water:false,stars:1.0,moonTint:0x7fa8d8,label:'Moon'},
  mars:{sky:['#0a0303','#150705','#221008'],skyDay:['#2c1b12','#54371d','#96704c'],
    fog:0x221008,fogDay:0x96704c,hemi:[0x4e2c20,0.45],sun:[0xd8926a,0.75],
    water:false,stars:0.5,moonTint:0xd8b090,label:'Mars'}
};

/* The sky is ONE 8x256 gradient canvas, repainted in place as the light
   changes. scene.background takes a texture, and a texture cannot cross-fade,
   so the blend has to happen in the pixels — but an 8x256 fill is 2k pixels, so
   repainting it is cheaper than almost anything else in the frame. It is still
   quantised to 1/64 of the cycle: below that the change is invisible and the
   texture upload is pure waste. */
const _skyC=document.createElement('canvas'); _skyC.width=8; _skyC.height=256;
const _skyCtx=_skyC.getContext('2d');
const _skyTex=new THREE.CanvasTexture(_skyC); _skyTex.encoding=THREE.sRGBEncoding;
const _a=new THREE.Color(), _b=new THREE.Color(), _m=new THREE.Color();
let _skyKey='';
function paintSky(cfg,f){
  const key=World.name+'|'+Math.round(f*64);
  if(key===_skyKey)return; _skyKey=key;
  const night=cfg.sky, day=cfg.skyDay||cfg.sky;
  const g=_skyCtx.createLinearGradient(0,0,0,256);
  for(let i=0;i<3;i++){
    _a.set(night[i]); _b.set(day[i]);
    _m.copy(_a).lerp(_b,f);
    g.addColorStop(i===0?0:i===1?0.55:1,'#'+_m.getHexString());
  }
  _skyCtx.fillStyle=g; _skyCtx.fillRect(0,0,8,256);
  _skyTex.needsUpdate=true;
}
export function refreshHemi(){hemi.intensity=worldHemiBase*(env.usePost?1.02:1.48)*(0.62+1.18*(S?S.dayF:1));}
export function applyWorld(w){
  World.name=w;const cfg=WORLD_CFG[w];
  _skyKey='';                       // force a repaint in the new world's palette
  paintSky(cfg,S?S.dayF:0);
  scene.background=_skyTex;
  scene.fog.color.setHex(cfg.fog);
  hemi.color.setHex(cfg.hemi[0]);worldHemiBase=cfg.hemi[1];refreshHemi();
  sun.color.setHex(cfg.sun[0]);sun.intensity=cfg.sun[1];
  water.visible=cfg.water;
  stars.material.opacity=cfg.stars;
  moon.material.color.setHex(cfg.moonTint);
  if(w==='mars'&&S&&S.state==='playing')setTimeout(()=>banner(t('banner.mars')),700);
  if(w==='moon'&&S&&S.state==='playing')setTimeout(()=>banner(t('banner.moon')),700);
}
