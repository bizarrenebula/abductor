/* =========================================================================
   MINIMAP — radial radar around the ship: crystals, plus story objectives
   (debris / samples / structures) color-coded per world and stage.
   ========================================================================= */
import { S } from '../core/state.js';
import { pickups } from '../entities/registry.js';
import { upgradeItems } from '../entities/upgradeItems.js';
import { saucer } from '../systems/saucer.js';
import { Story } from '../story/story.js';

const CRYSTAL_COL='#8fe8b8';

const mmCanvas=document.getElementById('minimap');
const mmCtx=mmCanvas&&mmCanvas.getContext('2d');
const MM_RANGE=340;
let mmSweep=0;
export function drawMinimap(dt){
  if(!mmCtx)return;
  const on=S.state==='playing';
  mmCanvas.classList.toggle('on',on);
  if(!on)return;
  const W=mmCanvas.width,H=mmCanvas.height,cx=W/2,cy=H/2,R=W/2-4;
  mmCtx.clearRect(0,0,W,H);
  mmCtx.save();mmCtx.beginPath();mmCtx.arc(cx,cy,R,0,7);mmCtx.clip();
  mmCtx.fillStyle='rgba(6,16,12,0.5)';mmCtx.fillRect(0,0,W,H);
  mmCtx.strokeStyle='rgba(143,232,184,0.14)';mmCtx.lineWidth=1;
  for(let i=1;i<=2;i++){mmCtx.beginPath();mmCtx.arc(cx,cy,R*i/2,0,7);mmCtx.stroke();}
  mmSweep+=dt*1.6;
  if(mmCtx.createConicGradient){
    const gr=mmCtx.createConicGradient(mmSweep,cx,cy);
    gr.addColorStop(0,'rgba(143,232,184,0.22)');gr.addColorStop(0.12,'rgba(143,232,184,0)');
    gr.addColorStop(1,'rgba(143,232,184,0)');mmCtx.fillStyle=gr;
    mmCtx.beginPath();mmCtx.arc(cx,cy,R,0,7);mmCtx.fill();
  }
  const sx=saucer.position.x,sz=saucer.position.z;
  const plot=(wx,wz,col,rad,pulse)=>{
    let dx=(wx-sx)/MM_RANGE*R, dy=(wz-sz)/MM_RANGE*R;
    const d=Math.hypot(dx,dy);let edge=false;
    if(d>R-3){const k=(R-3)/d;dx*=k;dy*=k;edge=true;}
    mmCtx.globalAlpha=edge?0.5:1;mmCtx.fillStyle=col;
    mmCtx.beginPath();mmCtx.arc(cx+dx,cy+dy,rad*(pulse?(0.8+0.4*Math.sin(performance.now()*0.006)):1),0,7);mmCtx.fill();
    mmCtx.globalAlpha=1;
  };
  // crystal locations — always shown (fuel + collectible)
  for(const pk of pickups)plot(pk.position.x,pk.position.z,CRYSTAL_COL,1.7,false);

  // findable ship-upgrade parts — special pulsing markers, larger when in sight
  for(const it of upgradeItems){
    const col='#'+it.userData.col.toString(16).padStart(6,'0');
    plot(it.position.x,it.position.z,col,it.userData.onScreen?3.8:2.6,true);
  }

  // current mission's objective markers only (no creature swarm)
  if(Story.active && Story.stage>=1 && Story.stage<=3){
    const w=Story.world, st=Story.stage;
    if(w==='earth'){
      if(st===1){
        for(const d of Story.debris)plot(d.position.x,d.position.z,'#ffb060',1.6,false);   // debris trail
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff5a48',3,true);           // mothership
      }else if(st===2){
        for(const s of Story.samples)                                                       // water / sand samples
          plot(s.position.x,s.position.z, s.userData.sampleKind==='water'?'#5cc8ff':'#d8a850',2.4,true);
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff5a48',3,true);            // return point
      }else if(st===3){
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff5a48',3,true);            // core (crystals already shown)
      }
    }else if(w==='moon'){
      if(st===1)for(const s of Story.targets)plot(s.position.x,s.position.z,'#ff3b52',2.4,true);   // spyders
      else if(st===2){
        for(const g of Story.guides)plot(g.position.x,g.position.z,'#7fffd0',1.4,false);
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#7fffd0',3.2,true);                 // lab
      }
      else if(st===3)for(const r of Story.targets)plot(r.position.x,r.position.z,'#9fe8ff',2.2,true);  // rocks
    }else if(w==='mars'){
      if(st===1){
        for(const g of Story.guides)plot(g.position.x,g.position.z,'#ff8050',1.4,false);
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff8050',3.2,true);                 // altar
      }else if(st===2){
        for(const s of Story.samples){const c='#'+(s.userData.color||0xffffff).toString(16).padStart(6,'0');plot(s.position.x,s.position.z,c,2.4,true);}
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff8050',3,true);
      }else if(st===3){
        if(Story.shipPos)plot(Story.shipPos.x,Story.shipPos.z,'#ff8050',3,true);            // altar (return point)
      }
    }
  }
  mmCtx.restore();
  mmCtx.fillStyle='#eafff4';mmCtx.beginPath();mmCtx.arc(cx,cy,2.4,0,7);mmCtx.fill();
}
