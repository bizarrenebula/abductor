/* =========================================================================
   MINIMAP — radial radar around the ship: towns, crystals, plus story
   objectives (debris / samples / structures) color-coded per world and stage.
   ========================================================================= */
import { S } from '../core/state.js';
import { pickups } from '../entities/registry.js';
import { upgradeItems } from '../entities/upgradeItems.js';
import { saucer } from '../systems/saucer.js';
import { Story } from '../story/story.js';
import { townsWithin } from '../world/settlements.js';
import { regionWeights, regionAt, REGION_NAME } from '../world/regions.js';

const CRYSTAL_COL='#8fe8b8';

const mmCanvas=document.getElementById('minimap');
const mmCtx=mmCanvas&&mmCanvas.getContext('2d');
const MM_RANGE=340;
let mmSweep=0;

/* ---- the land you are in, as a background tint -------------------------
   Yellow desert, green wilderness, blue urban. A flat tint rather than a
   per-texel wash: a region is ~6km across and the map reaches 340m, so a
   painted wash was one flat colour nine times in ten anyway — it cost ~800
   noise samples a refresh to say what one sample says.

   The one sample is taken as WEIGHTS, not as a label, so crossing a border
   fades the map from one colour to the next over the width of the blend instead
   of snapping. What lies beyond the map is the rim's job, below. */
const RGN_COL={des:[236,196,62], wild:[58,196,84], urb:[70,140,240]};
const RGN_KEY=['wild','des','urb'];
const rgbCss=(c,al)=>'rgba('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+','+al+')';
const _tint=[0,0,0];
function regionTint(sx,sz){
  const W=regionWeights(sx,sz);
  for(let i=0;i<3;i++)
    _tint[i]=RGN_COL.des[i]*W.des+RGN_COL.wild[i]*W.wild+RGN_COL.urb[i]*W.urb;
  return _tint;
}

/* ---- the rim: which lands are around you ------------------------------
   A region is ~6km across and the map reaches 340m, so the wash almost always
   shows one flat colour: it tells you where you ARE and nothing about what is
   next. The border answers that. It is painted in three parts — the land you
   are in, which holds most of the ring, and a cap for each of the other two on
   its true bearing, with the distance to it written across the middle of its
   cap.

   A cap GROWS as you close on that land: far off it is a token tick on the rim,
   and by the time the border is within map range it wraps a third of the ring.
   So approaching a biome reads as a band of colour opening up in the direction
   you are flying, and the number in it tells you how far.

   Bearings are ray-marched outward until the region changes; 32 bearings x up
   to 40 steps is ~1300 noise samples, so it refreshes about once a second and
   only after the ship has actually travelled. */
const SCAN_BEARINGS=32, SCAN_STEP=150, SCAN_MAX=6000;
let here=0, nbr=[], nbrX=1e9, nbrZ=1e9, nbrT=0;
function refreshNeighbours(sx,sz,dt){
  nbrT-=dt;
  if(nbrT>0 && Math.abs(sx-nbrX)<40 && Math.abs(sz-nbrZ)<40)return;
  nbrT=1.0; nbrX=sx; nbrZ=sz;
  here=regionAt(sx,sz);
  const best={};
  for(let i=0;i<SCAN_BEARINGS;i++){
    const a=i/SCAN_BEARINGS*Math.PI*2, cs=Math.cos(a), sn=Math.sin(a);
    const seen={}; let n=0;
    for(let d=SCAN_STEP;d<=SCAN_MAX;d+=SCAN_STEP){
      const r=regionAt(sx+cs*d, sz+sn*d);
      if(r===here||seen[r])continue;
      // keep scanning past the first crossing: the far land is usually behind
      // the near one on every bearing, and it still deserves its cap
      seen[r]=1; n++;
      if(!best[r]||d<best[r].d)best[r]={d,a};
      if(n>=2)break;
    }
  }
  nbr=[0,1,2].filter(r=>r!==here&&best[r]).map(r=>({region:r,d:best[r].d,a:best[r].a}));
}
function refreshRegionWash(sx,sz,dt){
  rgT-=dt;
  if(rgT>0 && Math.abs(sx-rgX)<10 && Math.abs(sz-rgZ)<10)return;
  rgT=0.25; rgX=sx; rgZ=sz;
  const d=rgImg.data;
  for(let j=0;j<RGN_N;j++)for(let i=0;i<RGN_N;i++){
    const wx=sx+((i+0.5)/RGN_N*2-1)*MM_RANGE;
    const wz=sz+((j+0.5)/RGN_N*2-1)*MM_RANGE;
    const W=regionWeights(wx,wz);
    const o=(j*RGN_N+i)*4;
    d[o  ]=RGN_COL.des[0]*W.des+RGN_COL.wild[0]*W.wild+RGN_COL.urb[0]*W.urb;
    d[o+1]=RGN_COL.des[1]*W.des+RGN_COL.wild[1]*W.wild+RGN_COL.urb[1]*W.urb;
    d[o+2]=RGN_COL.des[2]*W.des+RGN_COL.wild[2]*W.wild+RGN_COL.urb[2]*W.urb;
    d[o+3]=255;
  }
  rgCtx.putImageData(rgImg,0,0);
}
export function drawMinimap(dt){
  if(!mmCtx)return;
  const on=S.state==='playing';
  mmCanvas.classList.toggle('on',on);
  if(!on)return;
  const W=mmCanvas.width,H=mmCanvas.height,cx=W/2,cy=H/2,R=W/2-4;
  mmCtx.clearRect(0,0,W,H);
  mmCtx.save();mmCtx.beginPath();mmCtx.arc(cx,cy,R,0,7);mmCtx.clip();
  mmCtx.fillStyle='rgba(6,16,12,0.5)';mmCtx.fillRect(0,0,W,H);
  mmCtx.fillStyle=rgbCss(regionTint(saucer.position.x,saucer.position.z),0.30);
  mmCtx.fillRect(0,0,W,H);
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
  // Heading-up radar: rotate every marker by the ship's yaw so the nose always
  // points to the top of the map and the world spins around you as you turn.
  const yaw=S.yaw, ca=Math.cos(yaw), sa=Math.sin(yaw);
  const plot=(wx,wz,col,rad,pulse)=>{
    const ox=(wx-sx)/MM_RANGE*R, oz=(wz-sz)/MM_RANGE*R;
    let dx=ox*ca-oz*sa, dy=ox*sa+oz*ca;
    const d=Math.hypot(dx,dy);let edge=false;
    if(d>R-3){const k=(R-3)/d;dx*=k;dy*=k;edge=true;}
    mmCtx.globalAlpha=edge?0.5:1;mmCtx.fillStyle=col;
    mmCtx.beginPath();mmCtx.arc(cx+dx,cy+dy,rad*(pulse?(0.8+0.4*Math.sin(performance.now()*0.006)):1),0,7);mmCtx.fill();
    mmCtx.globalAlpha=1;
  };
  /* Villages, drawn UNDER everything else so they read as terrain rather than
     as objectives. One in range gets its actual footprint as a disc; one beyond
     the map gets a marker pinned to the rim, so the direction to the nearest
     settlement stays legible from well outside it. */
  for(const s of townsWithin(sx,sz,MM_RANGE*2.2)){
    const ox=(s.x-sx)/MM_RANGE*R, oz=(s.z-sz)/MM_RANGE*R;
    const dx=ox*ca-oz*sa, dy=ox*sa+oz*ca;
    const d=Math.hypot(dx,dy);
    const col='#c8b48a';
    if(d<R+s.r/MM_RANGE*R){
      // a village is small, so give the disc a floor or it vanishes on the map
      const rr=Math.max(3,s.r/MM_RANGE*R);
      mmCtx.globalAlpha=0.26;
      mmCtx.fillStyle=col;
      mmCtx.beginPath();mmCtx.arc(cx+dx,cy+dy,rr,0,7);mmCtx.fill();
      mmCtx.globalAlpha=0.7;
      mmCtx.strokeStyle=col;mmCtx.lineWidth=1;
      mmCtx.beginPath();mmCtx.arc(cx+dx,cy+dy,rr,0,7);mmCtx.stroke();
    }else{
      const k=(R-4)/d;
      mmCtx.globalAlpha=0.55;mmCtx.fillStyle=col;
      mmCtx.beginPath();mmCtx.arc(cx+dx*k,cy+dy*k,2.2,0,7);mmCtx.fill();
    }
    mmCtx.globalAlpha=1;
  }

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
  /* The rim. Drawn last inside the clip so it sits over the wash and the
     scenery markers but under the ship. */
  {
    refreshNeighbours(sx,sz,dt);
    /* The border belongs to the NEIGHBOURS — the land you are in is already the
       background tint, so painting it round the rim as well would only compete
       with the two colours that carry new information. What is left of the ring
       is a dim neutral track for the caps to sit in. */
    const RIM=5.5;
    mmCtx.strokeStyle='rgba(143,232,184,0.13)'; mmCtx.lineWidth=RIM;
    mmCtx.beginPath();mmCtx.arc(cx,cy,R-RIM/2,0,7);mmCtx.stroke();
    // Each neighbour's cap: a token tick when it is far, a third of the ring
    // when its border is on the map. Squared so the opening-up accelerates as
    // you actually get there rather than creeping the whole way.
    const MIN_HALF=0.12, MAX_HALF=0.95;
    mmCtx.font='600 8px ui-monospace,Menlo,monospace';
    mmCtx.textAlign='center'; mmCtx.textBaseline='middle';
    for(const nb of nbr){
      const col=RGN_COL[RGN_KEY[nb.region]]; if(!col)continue;
      const pr=1-Math.max(0,Math.min(1,(nb.d-MM_RANGE)/(SCAN_MAX-MM_RANGE)));
      const half=MIN_HALF+(MAX_HALF-MIN_HALF)*pr*pr;
      const mid=nb.a+yaw, t=RIM+2.6*pr;
      mmCtx.strokeStyle=rgbCss(col,0.55+0.42*pr); mmCtx.lineWidth=t;
      mmCtx.beginPath();mmCtx.arc(cx,cy,R-t/2,mid-half,mid+half);mmCtx.stroke();
      const km=nb.d>=1000?(nb.d/1000).toFixed(1)+'k':Math.round(nb.d/10)*10+'';
      const tx=cx+Math.cos(mid)*(R-15), ty=cy+Math.sin(mid)*(R-15);
      mmCtx.lineWidth=2.5; mmCtx.strokeStyle='rgba(4,10,8,0.9)';
      mmCtx.strokeText(km,tx,ty);                  // keep it readable over the wash
      mmCtx.fillStyle=rgbCss(col,1);
      mmCtx.fillText(km,tx,ty);
    }
    mmCtx.globalAlpha=1;
  }
  mmCtx.restore();
  // ship heading arrow at the centre — always points up (forward), since the map
  // is heading-up. A soft glow ring under it reads as the craft.
  mmCtx.fillStyle='rgba(143,232,184,0.18)';mmCtx.beginPath();mmCtx.arc(cx,cy,6,0,7);mmCtx.fill();
  mmCtx.fillStyle='#eafff4';
  mmCtx.beginPath();mmCtx.moveTo(cx,cy-6);mmCtx.lineTo(cx-4.2,cy+5);mmCtx.lineTo(cx,cy+2.6);mmCtx.lineTo(cx+4.2,cy+5);
  mmCtx.closePath();mmCtx.fill();
}
