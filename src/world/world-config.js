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

/* day/night: S.dayF is a smoothed 0..1 (0 night, 1 day); isDay is the discrete phase */
export function dayNightUpdate(dt){
  const cyc=S.endless?300:Math.max(30,S.timeLimit/2);   // endless: swap every 5 min; timed: halfway
  const phase=Math.floor(S.elapsed/cyc);
  const wantDay=(phase%2===0);                            // first half = day, then alternate
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
  // ambient: soft lift, not a flood
  hemi.intensity=worldHemiBase*(env.usePost?1.2:1.48)*(0.7+1.15*f);
  // warm sky fill by day; keep the world's cool night tint
  if(wc){_nightHemi.setHex(wc.hemi[0]);_dayHemi.setHex(World.name==='mars'?0xcaa080:0xbfd4e0);
    hemi.color.copy(_nightHemi).lerp(_dayHemi,f);}
  // the sun itself is the daytime story: warm, directional, strong-but-not-blinding
  const baseSun=(wc?wc.sun[1]:0.7);
  sun.intensity=baseSun*(0.35+1.35*f);
  sun.color.setRGB(lerp(0.62,1.0,f),lerp(0.75,0.95,f),lerp(1.0,0.82,f));  // cool moonlight → warm sun
  // gentle exposure lift only — avoids the "brightness maxed" look
  renderer.toneMappingExposure=(env.usePost?1.08:1.18)*(0.9+0.34*f);
  // haze warms and thins a little by day, near-black and denser at night
  if(wc){
    const nf=wc.fog;const nr=(nf>>16)&255,ng=(nf>>8)&255,nb=nf&255;
    scene.fog.color.setRGB(lerp(nr,120,f)/255,lerp(ng,140,f)/255,lerp(nb,158,f)/255);
  }
  scene.fog.density=lerp(env.LOW_END?0.0092:0.0062, env.LOW_END?0.0060:0.0040, f);
  // stars fade out by day, moon fades in by night
  if(stars)stars.material.opacity=(wc?wc.stars:0.7)*(1-f);
  if(moon)moon.material.opacity=0.9*(1-f)+0.15;
}
export const WORLD_CFG={
  earth:{sky:['#010203','#040a0d','#0a1416'],fog:0x070e10,hemi:[0x2c4450,0.42],sun:[0x8fb2c8,0.7],
    water:true,stars:0.7,moonTint:0xffffff,label:'Earth'},
  moon:{sky:['#000000','#010203','#040608'],fog:0x04060a,hemi:[0x40454e,0.35],sun:[0xdfe8f4,0.95],
    water:false,stars:1.0,moonTint:0x7fa8d8,label:'Moon'},
  mars:{sky:['#0a0303','#150705','#221008'],fog:0x190c07,hemi:[0x4e2c20,0.45],sun:[0xd8926a,0.75],
    water:false,stars:0.5,moonTint:0xd8b090,label:'Mars'}
};
const skyCache={};
function makeSky(cols){
  const c=document.createElement('canvas');c.width=8;c.height=256;
  const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,256);
  g.addColorStop(0,cols[0]);g.addColorStop(0.55,cols[1]);g.addColorStop(1,cols[2]);
  ctx.fillStyle=g;ctx.fillRect(0,0,8,256);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
}
export function refreshHemi(){hemi.intensity=worldHemiBase*(env.usePost?1.2:1.48)*(0.55+1.15*(S?S.dayF:1));}
export function applyWorld(w){
  World.name=w;const cfg=WORLD_CFG[w];
  scene.background=skyCache[w]||(skyCache[w]=makeSky(cfg.sky));
  scene.fog.color.setHex(cfg.fog);
  hemi.color.setHex(cfg.hemi[0]);worldHemiBase=cfg.hemi[1];refreshHemi();
  sun.color.setHex(cfg.sun[0]);sun.intensity=cfg.sun[1];
  water.visible=cfg.water;
  stars.material.opacity=cfg.stars;
  moon.material.color.setHex(cfg.moonTint);
  if(w==='mars'&&S&&S.state==='playing')setTimeout(()=>banner(t('banner.mars')),700);
  if(w==='moon'&&S&&S.state==='playing')setTimeout(()=>banner(t('banner.moon')),700);
}
