/* =========================================================================
   SUN LENS FLARE — day-only screen-space flare that tracks the sun, plus the
   full-screen lightning flash overlay element (driven by hazards/lightning).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { camera, sun } from '../core/engine.js';
import { saucer } from '../systems/saucer.js';

const flareEls=[];
(function(){
  const wrap=document.createElement('div');
  wrap.id='flare';wrap.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:4;overflow:hidden;mix-blend-mode:screen';
  document.body.appendChild(wrap);
  const specs=[[70,'rgba(255,240,200,0.55)',0.0],[26,'rgba(180,220,255,0.35)',0.32],
    [46,'rgba(255,210,170,0.28)',0.55],[16,'rgba(200,255,230,0.4)',0.78],[120,'rgba(255,245,220,0.18)',-0.25]];
  specs.forEach(s=>{const e=document.createElement('div');
    e.style.cssText='position:absolute;border-radius:50%;width:'+s[0]+'px;height:'+s[0]+'px;background:radial-gradient(circle,'+s[1]+',transparent 70%);transform:translate(-50%,-50%)';
    e.dataset.t=s[2];wrap.appendChild(e);flareEls.push(e);});
  window._flareWrap=wrap;
  const lf=document.createElement('div');
  lf.id='lflash';lf.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5;background:#dfeeff;opacity:0;mix-blend-mode:screen';
  document.body.appendChild(lf);window._lflash=lf;
})();
const _sv=new THREE.Vector3();
let flarePulse=0;
export function updateFlare(dt){
  const wrap=window._flareWrap;if(!wrap)return;
  if(S.state!=='playing'||S.dayF<0.55){wrap.style.opacity=0;return;}
  // sun position on screen
  _sv.copy(sun.position).sub(saucer.position).normalize().multiplyScalar(600).add(camera.position);
  _sv.project(camera);
  if(_sv.z>1){wrap.style.opacity=0;return;}
  const sxp=(_sv.x*0.5+0.5)*innerWidth, syp=(-_sv.y*0.5+0.5)*innerHeight;
  const cxp=innerWidth/2, cyp=innerHeight/2;
  const onScreen=_sv.x>-1.1&&_sv.x<1.1&&_sv.y>-1.1&&_sv.y<1.1;
  // occasional shimmer
  flarePulse+=dt*(0.5+Math.random()*0.3);
  const shimmer=0.55+0.45*Math.sin(flarePulse*1.3);
  wrap.style.opacity=onScreen?(0.85*shimmer*Math.min(1,(S.dayF-0.55)/0.3)):0;
  flareEls.forEach(e=>{const t=+e.dataset.t;
    e.style.left=(sxp+(cxp-sxp)*t)+'px';e.style.top=(syp+(cyp-syp)*t)+'px';});
}
