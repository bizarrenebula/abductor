/* =========================================================================
   PROCEDURAL TEXTURES — grass / sand / rock / snow / water / precipitation,
   all drawn to canvases at import time. TEX holds any custom images loaded
   later by the asset loader (name -> THREE.Texture).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { renderer } from '../core/engine.js';

export const TEX = {};   // name -> THREE.Texture (populated by the asset loader)

const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

function canvasTex(draw,size){size=size||256;const c=document.createElement('canvas');c.width=c.height=size;
  draw(c.getContext('2d'),size);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=MAX_ANISO;return t;}

export const grassTex=canvasTex((x,s)=>{x.fillStyle='#5c6b52';x.fillRect(0,0,s,s);
  for(let i=0;i<5200;i++){const l=55+Math.random()*85;
    x.strokeStyle='rgba('+(l*0.75|0)+','+(l|0)+','+(l*0.7|0)+',0.45)';
    const px=Math.random()*s,py=Math.random()*s,len=2+Math.random()*6;
    x.beginPath();x.moveTo(px,py);x.lineTo(px+(Math.random()-0.5)*3,py-len);x.stroke();}});
export const sandTex=canvasTex((x,s)=>{x.fillStyle='#8a7c62';x.fillRect(0,0,s,s);
  for(let y=0;y<s;y++){const w=Math.sin(y*0.11)*10;
    for(let k=0;k<3;k++){const px=(Math.random()*s+w+s)%s;
      const l=110+Math.sin(y*0.11)*30+Math.random()*30;
      x.fillStyle='rgba('+(l|0)+','+(l*0.88|0)+','+(l*0.66|0)+',0.25)';
      x.fillRect(px,y,3+Math.random()*5,1);}}
  for(let i=0;i<1600;i++){const l=60+Math.random()*140;
    x.fillStyle='rgba('+(l|0)+','+(l*0.9|0)+','+(l*0.7|0)+',0.3)';
    x.fillRect(Math.random()*s,Math.random()*s,1.5,1.5);}});
export const rockTex=canvasTex((x,s)=>{x.fillStyle='#6d6d70';x.fillRect(0,0,s,s);
  for(let i=0;i<900;i++){const l=45+Math.random()*120,r=2+Math.random()*14;
    x.fillStyle='rgba('+(l|0)+','+(l|0)+','+(l*1.05|0)+',0.22)';
    x.beginPath();x.arc(Math.random()*s,Math.random()*s,r,0,7);x.fill();}
  for(let i=0;i<50;i++){x.strokeStyle='rgba(30,30,34,0.35)';x.lineWidth=1;
    x.beginPath();let px=Math.random()*s,py=Math.random()*s;x.moveTo(px,py);
    for(let k=0;k<5;k++){px+=(Math.random()-0.5)*30;py+=Math.random()*14;x.lineTo(px,py);}x.stroke();}});
export const snowTex=canvasTex((x,s)=>{x.fillStyle='#b4c0c8';x.fillRect(0,0,s,s);
  for(let i=0;i<900;i++){const l=170+Math.random()*85,r=1+Math.random()*6;
    x.fillStyle='rgba('+(l|0)+','+(l|0)+','+Math.min(255,l*1.06|0)+',0.25)';
    x.beginPath();x.arc(Math.random()*s,Math.random()*s,r,0,7);x.fill();}
  for(let i=0;i<300;i++){x.fillStyle='rgba(255,255,255,'+(0.4+Math.random()*0.5)+')';
    x.fillRect(Math.random()*s,Math.random()*s,1.4,1.4);}});
export const waterNoiseTex=canvasTex((x,s)=>{x.fillStyle='#808080';x.fillRect(0,0,s,s);
  for(let i=0;i<700;i++){const l=90+Math.random()*90,r=4+Math.random()*22;
    const gr=x.createRadialGradient(0,0,0,0,0,r);
    gr.addColorStop(0,'rgba('+(l|0)+','+(l|0)+','+(l|0)+',0.35)');gr.addColorStop(1,'rgba(128,128,128,0)');
    x.save();x.translate(Math.random()*s,Math.random()*s);x.fillStyle=gr;
    x.beginPath();x.arc(0,0,r,0,7);x.fill();x.restore();}});
export const rainTex=canvasTex((x,s)=>{const gr=x.createLinearGradient(0,0,0,s);
  gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(0.5,'rgba(255,255,255,0.9)');gr.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=gr;x.fillRect(s*0.44,0,s*0.12,s);},64);
export const dotTex=canvasTex((x,s)=>{const gr=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(0.6,'rgba(255,255,255,0.5)');gr.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=gr;x.fillRect(0,0,s,s);},64);
export const grainTex=canvasTex((x,s)=>{for(let i=0;i<40;i++){const r=1+Math.random()*3,l=200+Math.random()*55;
  x.fillStyle='rgba('+(l|0)+','+(l*0.85|0)+','+(l*0.6|0)+','+(0.3+Math.random()*0.5)+')';
  x.beginPath();x.arc(Math.random()*s,Math.random()*s,r,0,7);x.fill();}},64);
export const PARTTEX={rain:rainTex,dot:dotTex,grain:grainTex};
